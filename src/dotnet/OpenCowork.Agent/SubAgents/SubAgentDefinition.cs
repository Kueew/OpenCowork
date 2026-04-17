using System.Text.Json.Serialization;

namespace OpenCowork.Agent.SubAgents;

/// <summary>
/// Static definition for a sub-agent. Mirrors the TypeScript SubAgentDefinition.
/// </summary>
public sealed class SubAgentDefinition
{
    public const int DefaultMaxTurns = 12;

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("systemPrompt")]
    public string? SystemPrompt { get; init; }

    [JsonPropertyName("tools")]
    public List<string>? Tools { get; init; }

    [JsonPropertyName("disallowedTools")]
    public List<string>? DisallowedTools { get; init; }

    /// <summary>
    /// Non-positive values fall back to <see cref="DefaultMaxTurns"/> to avoid
    /// runaway retry loops when a sub-agent keeps reissuing the same failing tool call.
    /// </summary>
    [JsonPropertyName("maxTurns")]
    public int MaxTurns { get; init; } = 0;

    [JsonPropertyName("initialPrompt")]
    public string? InitialPrompt { get; init; }

    [JsonPropertyName("model")]
    public string? Model { get; init; }

    [JsonPropertyName("temperature")]
    public double? Temperature { get; init; }

    public static int ResolveMaxTurns(int maxTurns) =>
        maxTurns > 0 ? maxTurns : DefaultMaxTurns;
}
