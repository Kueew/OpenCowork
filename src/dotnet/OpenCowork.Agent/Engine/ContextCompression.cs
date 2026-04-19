using System.Text.Json;
using System.Text.RegularExpressions;

namespace OpenCowork.Agent.Engine;

public sealed class CompressionConfig
{
    public bool Enabled { get; init; }
    public int ContextLength { get; init; }
    public double Threshold { get; init; } = 0.8;
    public double PreCompressThreshold { get; init; } = 0.65;
    public int ReservedOutputBudget { get; init; } = 20_000;
}

/// <summary>
/// Context compression logic for managing conversation length.
/// Two-tier: pre-compression (trim tool results/thinking) and
/// full compression (summarize via LLM with analysis/summary two-phase).
/// </summary>
public static class ContextCompression
{
    /// <summary>Number of recent messages to preserve after full compression.</summary>
    private const int PreserveRecentCount = 4;
    private const int ToolResultKeepRecent = 6;
    private const int DefaultReservedOutputTokens = 20_000;
    private const int AutoBufferTokens = 13_000;
    private const int PreBufferTokens = 20_000;
    private const int PreGapTokens = 8_000;
    private const int ToolResultClearCharThreshold = 200;
    private const int BoundaryScanLimit = 10;
    private const string ClearedToolResultPlaceholder = "[Tool result compressed]";
    private const string ClearedThinkingPlaceholder = "[Thinking compressed]";
    private const string CompactBoundaryText = "Conversation compacted";

    /// <summary>Max retry attempts for compression failures.</summary>
    private const int MaxRetries = 2;

    /// <summary>Max consecutive failures before circuit-breaking.</summary>
    private const int MaxConsecutiveFailures = 3;

    /// <summary>Circuit breaker counter (resets on success).</summary>
    private static int _consecutiveFailures;

    public static void ResetFailures() => _consecutiveFailures = 0;

    private static int GetEffectiveContextWindow(CompressionConfig config)
    {
        if (config.ContextLength <= 0) return 0;
        var reserved = Math.Max(0, config.ReservedOutputBudget > 0
            ? config.ReservedOutputBudget
            : DefaultReservedOutputTokens);
        return Math.Max(1, config.ContextLength - reserved);
    }

    private static int GetCompressionTriggerTokens(CompressionConfig config)
    {
        var effectiveWindow = GetEffectiveContextWindow(config);
        if (effectiveWindow <= 0) return 0;

        var ratioThreshold = (int)Math.Floor(effectiveWindow * config.Threshold);
        var bufferedThreshold = effectiveWindow - AutoBufferTokens;
        var threshold = bufferedThreshold > 0
            ? Math.Min(ratioThreshold, bufferedThreshold)
            : ratioThreshold;
        return Math.Max(1, threshold);
    }

    private static int GetPreCompressionTriggerTokens(CompressionConfig config)
    {
        var effectiveWindow = GetEffectiveContextWindow(config);
        if (effectiveWindow <= 0) return 0;

        var ratioThreshold = (int)Math.Floor(effectiveWindow * config.PreCompressThreshold);
        var fullThreshold = GetCompressionTriggerTokens(config);
        var threshold = ratioThreshold;

        var bufferedThreshold = effectiveWindow - PreBufferTokens;
        if (bufferedThreshold > 0)
            threshold = Math.Min(threshold, bufferedThreshold);

        var gapThreshold = fullThreshold - PreGapTokens;
        if (gapThreshold > 0)
            threshold = Math.Min(threshold, gapThreshold);

        return Math.Max(1, Math.Min(threshold, Math.Max(1, fullThreshold - 1)));
    }

    public static bool ShouldCompress(int inputTokens, CompressionConfig config)
    {
        if (!config.Enabled || config.ContextLength <= 0) return false;
        if (_consecutiveFailures >= MaxConsecutiveFailures) return false;
        return inputTokens >= GetCompressionTriggerTokens(config);
    }

    public static bool ShouldPreCompress(int inputTokens, CompressionConfig config)
    {
        if (!config.Enabled || config.ContextLength <= 0) return false;
        var preThreshold = GetPreCompressionTriggerTokens(config);
        var fullThreshold = GetCompressionTriggerTokens(config);
        return inputTokens >= preThreshold && inputTokens < fullThreshold;
    }

    /// <summary>
    /// Pre-compress by replacing long tool results, thinking blocks, and image blocks
    /// in older messages. Preserves the last 6 messages. When the list exceeds 30 messages,
    /// drops the oldest non-system messages beyond the preserve window.
    /// Does not call the LLM.
    /// </summary>
    public static List<UnifiedMessage> PreCompressMessages(List<UnifiedMessage> messages)
    {
        if (messages.Count <= ToolResultKeepRecent) return messages;

        var result = new List<UnifiedMessage>(messages.Count);
        var preserveFrom = messages.Count - ToolResultKeepRecent;

        // When message list grows very large, drop oldest non-system messages
        var dropBefore = 0;
        if (messages.Count > 30)
        {
            dropBefore = messages.Count - 20;
        }

        for (var i = 0; i < messages.Count; i++)
        {
            var msg = messages[i];

            // Always keep system messages
            if (i < dropBefore && msg.Role != "system")
                continue;

            if (i >= preserveFrom)
            {
                result.Add(msg);
                continue;
            }

            var blocks = msg.Content;
            if (blocks is null || blocks.Count == 0)
            {
                result.Add(msg);
                continue;
            }

            var compressed = false;
            var newContent = new List<ContentBlock>();

            foreach (var block in blocks)
            {
                if (block is ToolResultBlock trb && trb.GetTextContent().Length > ToolResultClearCharThreshold)
                {
                    newContent.Add(new ToolResultBlock
                    {
                        ToolUseId = trb.ToolUseId,
                        Content = ClearedToolResultPlaceholder,
                        IsError = trb.IsError
                    });
                    compressed = true;
                }
                else if (block is ThinkingBlock)
                {
                    newContent.Add(new TextBlock { Text = ClearedThinkingPlaceholder });
                    compressed = true;
                }
                else if (block is ImageBlock)
                {
                    newContent.Add(new TextBlock { Text = "[image]" });
                    compressed = true;
                }
                else
                {
                    newContent.Add(block);
                }
            }

            if (compressed)
            {
                result.Add(new UnifiedMessage
                {
                    Id = msg.Id,
                    Role = msg.Role,
                    Content = newContent,
                    CreatedAt = msg.CreatedAt,
                    Usage = msg.Usage,
                    ProviderResponseId = msg.ProviderResponseId,
                    Source = msg.Source,
                    Meta = msg.Meta
                });
            }
            else
            {
                result.Add(msg);
            }
        }

        return result;
    }

    /// <summary>
    /// Full compression: summarize older conversation history via the LLM provider,
    /// preserving the most recent messages intact. Uses analysis/summary two-phase
    /// prompting and tool_use/tool_result pair protection.
    /// </summary>
    public static async Task<List<UnifiedMessage>> CompressMessagesAsync(
        List<UnifiedMessage> messages,
        Providers.ILlmProvider provider,
        ProviderConfig config,
        int preTokens,
        CancellationToken ct)
    {
        if (messages.Count <= PreserveRecentCount + 2) return messages;

        // Find safe boundary that doesn't split tool_use/tool_result pairs
        var boundaryIdx = FindSafeCompactBoundary(messages, messages.Count - PreserveRecentCount);
        var messagesToCompress = messages.Take(boundaryIdx).ToList();
        var messagesToPreserve = messages.Skip(boundaryIdx).ToList();

        if (messagesToCompress.Count < 2) return messages;

        // Retry with exponential backoff
        Exception? lastError = null;
        for (var attempt = 0; attempt <= MaxRetries; attempt++)
        {
            try
            {
                var inputMessages = attempt == 0
                    ? messagesToCompress
                    : TruncateOldestMessages(messagesToCompress, attempt);

                var serialized = SerializeCompressionInput(inputMessages);

                var summaryRequest = new List<UnifiedMessage>
                {
                    new()
                    {
                        Role = "user",
                        Content = new List<ContentBlock>
                        {
                            new TextBlock
                            {
                                Text = $"""
                                Please create a detailed summary of the following conversation history.
                                This summary will REPLACE the original messages, so nothing important can be lost.

                                ---
                                {serialized}
                                """
                            }
                        }
                    }
                };

                var summaryConfig = new ProviderConfig
                {
                    Type = config.Type,
                    ApiKey = config.ApiKey,
                    BaseUrl = config.BaseUrl,
                    Model = config.Model,
                    MaxTokens = 8000,
                    SystemPrompt = CompactSystemPrompt,
                    ResponsesSessionScope = "context-compression",
                    WebsocketUrl = config.WebsocketUrl,
                    WebsocketMode = "disabled"
                };

                var summaryBuilder = new System.Text.StringBuilder();
                await foreach (var evt in provider.SendMessageAsync(
                    summaryRequest, [], summaryConfig, ct))
                {
                    if (evt.Type == "text_delta" && evt.Text is not null)
                        summaryBuilder.Append(evt.Text);
                }

                var rawSummary = summaryBuilder.ToString();
                var summary = FormatCompactSummary(rawSummary);

                if (string.IsNullOrWhiteSpace(summary))
                    throw new InvalidOperationException("Compression returned empty summary");

                _consecutiveFailures = 0;

                var summaryMessage = CreateCompactSummaryMessage(
                    summary,
                    messagesToCompress.Count,
                    messagesToPreserve.Count > 0);

                var boundaryMessage = CreateCompactBoundaryMessage(
                    "auto",
                    preTokens,
                    messagesToCompress.Count,
                    summaryMessage.Id,
                    messagesToPreserve);

                return [boundaryMessage, summaryMessage, .. messagesToPreserve];
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                lastError = ex;
                if (attempt < MaxRetries)
                {
                    await Task.Delay(1500 * (int)Math.Pow(2, attempt), ct);
                }
            }
        }

        // All retries exhausted — circuit breaker
        _consecutiveFailures++;
        Console.Error.WriteLine(
            $"[ContextCompression] All retries failed (consecutive: {_consecutiveFailures}/{MaxConsecutiveFailures}): {lastError?.Message}");

        return messages;
    }

    /// <summary>
    /// Find a safe boundary that doesn't split tool_use/tool_result pairs.
    /// </summary>
    private static int FindSafeCompactBoundary(List<UnifiedMessage> messages, int initialBoundary)
    {
        var boundary = Math.Max(1, Math.Min(initialBoundary, messages.Count - 1));

        for (var attempts = 0; attempts < BoundaryScanLimit; attempts++)
        {
            var compressedToolUseIds = new HashSet<string>();
            for (var i = 0; i < boundary; i++)
            {
                var msg = messages[i];
                if (msg.Content is null) continue;
                foreach (var block in msg.Content)
                {
                    if (block is ToolUseBlock tub && tub.Id is not null)
                        compressedToolUseIds.Add(tub.Id);
                }
            }

            var hasSplit = false;
            for (var i = boundary; i < messages.Count && !hasSplit; i++)
            {
                var msg = messages[i];
                if (msg.Content is null) continue;
                foreach (var block in msg.Content)
                {
                    if (block is ToolResultBlock trb && trb.ToolUseId is not null
                        && compressedToolUseIds.Contains(trb.ToolUseId))
                    {
                        hasSplit = true;
                        break;
                    }
                }
            }

            if (!hasSplit) return boundary;
            boundary = Math.Max(1, boundary - 1);
        }

        return boundary;
    }

    /// <summary>
    /// Truncate oldest non-system messages for retry attempts.
    /// </summary>
    private static List<UnifiedMessage> TruncateOldestMessages(List<UnifiedMessage> messages, int attempt)
    {
        var dropCount = (int)Math.Ceiling(messages.Count * 0.25 * attempt);
        var result = new List<UnifiedMessage>();
        var dropped = 0;
        var isFirst = true;
        foreach (var msg in messages)
        {
            if (msg.Role == "system" || (isFirst && msg.Role == "user"))
            {
                result.Add(msg);
                isFirst = false;
                continue;
            }
            isFirst = false;
            if (dropped < dropCount)
            {
                dropped++;
                continue;
            }
            result.Add(msg);
        }
        return result.Count >= 2 ? result : messages;
    }

    /// <summary>
    /// Strip analysis drafting scratchpad and extract summary content.
    /// </summary>
    private static string FormatCompactSummary(string rawSummary)
    {
        var result = rawSummary;

        // Strip <analysis> section
        result = Regex.Replace(result, @"<analysis>[\s\S]*?</analysis>", "", RegexOptions.IgnoreCase);

        // Extract <summary> content
        var match = Regex.Match(result, @"<summary>([\s\S]*?)</summary>", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            result = match.Groups[1].Value;
        }

        // Clean up whitespace
        result = Regex.Replace(result, @"\n\n+", "\n\n").Trim();
        return result;
    }

    private static string SerializeCompressionInput(List<UnifiedMessage> messages)
    {
        var parts = new List<string>();
        var originalTask = FindOriginalTaskMessage(messages);
        if (originalTask is not null)
        {
            parts.Add("## Original Task");
            parts.Add(SerializeMessage(originalTask));
        }

        parts.Add("## Full Conversation History");
        parts.Add(SerializeMessages(messages));
        return string.Join("\n\n", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static UnifiedMessage? FindOriginalTaskMessage(List<UnifiedMessage> messages)
    {
        foreach (var message in messages)
        {
            if (!string.Equals(message.Role, "user", StringComparison.Ordinal))
                continue;
            if (string.Equals(message.Source, "team", StringComparison.Ordinal))
                continue;
            if (message.Meta?.CompactSummary is not null)
                continue;

            if (message.RawContent is { ValueKind: JsonValueKind.String } rawString
                && !string.IsNullOrWhiteSpace(rawString.GetString()))
            {
                return message;
            }

            var blocks = message.GetBlockContent();
            if (blocks.Any(block => block is TextBlock or ImageBlock))
                return message;
        }

        return null;
    }

    private static string SerializeMessages(List<UnifiedMessage> messages)
    {
        var parts = new List<string>();
        foreach (var message in messages)
        {
            var serialized = SerializeMessage(message);
            if (!string.IsNullOrWhiteSpace(serialized))
                parts.Add(serialized);
        }
        return string.Join("\n\n", parts);
    }

    private static string SerializeMessage(UnifiedMessage message)
    {
        var role = message.Role.ToUpperInvariant();
        var content = SerializeMessageContent(message);
        return string.IsNullOrWhiteSpace(content) ? string.Empty : $"[{role}]: {content}";
    }

    private static string SerializeMessageContent(UnifiedMessage message)
    {
        if (message.RawContent is { ValueKind: JsonValueKind.String } rawString)
            return rawString.GetString() ?? string.Empty;

        return string.Join("\n", message.GetBlockContent()
            .Select(SerializeContentBlock)
            .Where(text => !string.IsNullOrWhiteSpace(text)));
    }

    private static string SerializeContentBlock(ContentBlock block) => block switch
    {
        TextBlock textBlock => textBlock.Text,
        ThinkingBlock => string.Empty,
        ToolUseBlock toolUse => $"[Tool call: {toolUse.Name}] {SerializeToolInput(toolUse.Input)}",
        ToolResultBlock toolResult => $"[Tool result error={toolResult.IsError == true}] {SerializeToolResult(toolResult)}",
        ImageBlock => "[image]",
        ImageErrorBlock imageError => $"[Image error: {imageError.Message}]",
        _ => string.Empty
    };

    private static string SerializeToolInput(Dictionary<string, JsonElement> input)
    {
        var serialized = JsonSerializer.Serialize(input, AppJsonContext.Default.DictionaryStringJsonElement);
        return serialized.Length > 500 ? serialized[..500] : serialized;
    }

    private static string SerializeToolResult(ToolResultBlock block)
    {
        var text = block.GetTextContent();
        return text.Length > 800 ? $"{text[..800]}\n... [truncated, {text.Length} chars total]" : text;
    }

    private static UnifiedMessage CreateCompactBoundaryMessage(
        string trigger,
        int preTokens,
        int messagesSummarized,
        string summaryMessageId,
        List<UnifiedMessage> preservedMessages)
    {
        return new UnifiedMessage
        {
            Role = "system",
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            RawContent = JsonSerializer.SerializeToElement(CompactBoundaryText, AppJsonContext.Default.String),
            Meta = new MessageMeta
            {
                CompactBoundary = new CompactBoundaryMeta
                {
                    Trigger = trigger,
                    PreTokens = preTokens,
                    MessagesSummarized = messagesSummarized,
                    PreservedSegment = preservedMessages.Count > 0
                        ? new CompactBoundarySegment
                        {
                            HeadId = preservedMessages[0].Id,
                            AnchorId = summaryMessageId,
                            TailId = preservedMessages[^1].Id
                        }
                        : null
                }
            }
        };
    }

    private static UnifiedMessage CreateCompactSummaryMessage(
        string summary,
        int messagesSummarized,
        bool recentMessagesPreserved)
    {
        var text =
            $"[Context Memory Compressed Summary]\n\n" +
            "This session continues from a previous conversation. " +
            $"The following summary covers {messagesSummarized} earlier messages.";

        if (recentMessagesPreserved)
            text += " Recent messages are preserved verbatim after this summary.";

        text += $"\n\n{summary}";

        return new UnifiedMessage
        {
            Role = "user",
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            RawContent = JsonSerializer.SerializeToElement(text, AppJsonContext.Default.String),
            Meta = new MessageMeta
            {
                CompactSummary = new CompactSummaryMeta
                {
                    MessagesSummarized = messagesSummarized,
                    RecentMessagesPreserved = recentMessagesPreserved
                }
            }
        };
    }

    private const string CompactSystemPrompt = """
        You are a precision memory compressor for an AI coding assistant.
        Your job is to create an EXTREMELY DETAILED structured summary of a conversation history.
        This summary will REPLACE the original messages, so NOTHING important can be lost.

        ## Critical Rules
        1. You MUST preserve ALL file paths, function names, variable names, and code snippets mentioned.
        2. You MUST preserve the COMPLETE current task status — what is done, what is in progress, what is pending.
        3. You MUST preserve ALL technical decisions and their reasoning.
        4. You MUST preserve ALL errors encountered and their resolutions.
        5. You MUST preserve any Todo/task list with exact status of each item.
        6. If code was written or modified, summarize the EXACT changes (function signatures, logic, imports added).
        7. Do NOT generalize or hand-wave. Be specific. Use exact names, paths, and values.
        8. Write in the same language as the conversation.
        9. Pay special attention to specific user feedback — especially if the user told you to do something differently.

        ## Process

        Before providing your final summary, wrap your detailed analysis in <analysis> tags:

        1. Chronologically analyze each section of the conversation. For each section identify:
           - The user's explicit requests and intents
           - Key decisions, technical concepts and code patterns
           - Specific details: file names, code snippets, function signatures
           - Errors encountered and how they were fixed
           - User feedback, especially corrections
        2. Double-check for technical accuracy and completeness.

        Then provide your final summary inside <summary> tags.

        ## Output Format

        <analysis>
        [Your detailed thought process]
        </analysis>

        <summary>
        ## 1. Primary Request and Intent
        Capture ALL of the user's explicit requests and intents.

        ## 2. Key Technical Concepts
        List all important technical concepts, technologies, and frameworks.

        ## 3. Files and Code Sections
        Enumerate specific files and code sections with code snippets.

        ## 4. Errors and Fixes
        List all errors encountered and their resolutions.

        ## 5. Problem Solving
        Document problems solved and ongoing troubleshooting.

        ## 6. All User Messages
        List ALL user messages that are NOT tool results.

        ## 7. Pending Tasks
        Outline pending tasks with exact status.

        ## 8. Current Work
        Describe precisely what was being worked on before this summary.

        ## 9. Optional Next Step
        List the next step in line with the user's most recent request.
        Include direct quotes from the conversation.
        </summary>
        """;
}
