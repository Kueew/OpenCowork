import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as projectsDao from '../db/projects-dao'
import * as wikiDao from '../db/wiki-dao'
import { glob } from 'glob'
import { createGitIgnoreMatcher } from './gitignore-utils'
import { getSshClientForGitExec } from './ssh-handlers'

const DEFAULT_WIKI_EXPORT_DIR = '.agents/wiki-export'
const SOURCE_INCLUDE_PATTERNS = [
  'src/**/*.{ts,tsx,js,jsx,py,go,rs,java,cs}',
  'package.json',
  'README*',
  'docs/**/*',
  '*.json',
  '*.yml',
  '*.yaml'
]
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'target']

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'wiki'
  )
}

async function createLocalIgnoreMatcher(
  rootDir: string
): Promise<Awaited<ReturnType<typeof createGitIgnoreMatcher>>> {
  return createGitIgnoreMatcher({
    rootDir,
    readIgnoreFile: async (filePath) => {
      try {
        return await fs.promises.readFile(filePath, 'utf8')
      } catch {
        return null
      }
    }
  })
}

async function collectProjectFiles(rootDir: string): Promise<string[]> {
  const matcher = await createLocalIgnoreMatcher(rootDir)
  const result = new Set<string>()
  for (const pattern of SOURCE_INCLUDE_PATTERNS) {
    const matches = await glob(pattern, {
      cwd: rootDir,
      nodir: true,
      ignore: IGNORED_DIRS.map((item) => `**/${item}/**`)
    })
    for (const match of matches) {
      const abs = path.join(rootDir, match)
      if (await matcher.ignores(abs, false)) continue
      result.add(match.replace(/\\/g, '/'))
    }
  }
  return Array.from(result).sort((a, b) => a.localeCompare(b))
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function joinWorkspacePath(
  workingFolder: string,
  sshConnectionId: string | null,
  ...segments: string[]
): string {
  return sshConnectionId
    ? path.posix.join(workingFolder, ...segments)
    : path.join(workingFolder, ...segments)
}

function execSshCommand(
  connectionId: string,
  command: string,
  timeout = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    void (async () => {
      const client = await getSshClientForGitExec(connectionId)
      if (!client) {
        resolve({ stdout: '', stderr: `SSH connection unavailable: ${connectionId}`, exitCode: 1 })
        return
      }

      const timer = setTimeout(() => {
        resolve({ stdout: '', stderr: 'SSH exec timeout', exitCode: 124 })
      }, timeout)
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          resolve({ stdout: '', stderr: err.message, exitCode: 1 })
          return
        }
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        stream.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        stream.on('close', (exitCode: number) => {
          clearTimeout(timer)
          resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
        })
      })
    })().catch((error) => {
      resolve({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      })
    })
  })
}

async function collectRemoteProjectFiles(
  rootDir: string,
  sshConnectionId: string
): Promise<string[]> {
  const ignored = IGNORED_DIRS.map((item) => `-path './${item}' -o -path '*/${item}/*'`).join(
    ' -o '
  )
  const filePredicates = [
    "-name '*.ts'",
    "-name '*.tsx'",
    "-name '*.js'",
    "-name '*.jsx'",
    "-name '*.py'",
    "-name '*.go'",
    "-name '*.rs'",
    "-name '*.java'",
    "-name '*.cs'",
    "-name 'package.json'",
    "-iname 'README*'",
    "-path './docs/*'",
    "-name '*.json'",
    "-name '*.yml'",
    "-name '*.yaml'"
  ].join(' -o ')
  const result = await execSshCommand(
    sshConnectionId,
    `cd ${shellEscape(rootDir)} && find . \\( ${ignored} \\) -prune -o -type f \\( ${filePredicates} \\) -print | sed 's#^./##' | head -2000`,
    60_000
  )
  if (result.exitCode !== 0) return []
  return normalizeLines(result.stdout)
}

async function collectProjectFilesForTarget(
  rootDir: string,
  sshConnectionId: string | null
): Promise<string[]> {
  if (sshConnectionId) return collectRemoteProjectFiles(rootDir, sshConnectionId)
  return collectProjectFiles(rootDir)
}

function deriveModuleGroups(
  files: string[]
): Array<{ name: string; description: string; files: string[] }> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const parts = file.split('/').filter(Boolean)
    const key = parts[0] === 'src' && parts[1] ? `src/${parts[1]}` : (parts[0] ?? 'root')
    const bucket = groups.get(key) ?? []
    bucket.push(file)
    groups.set(key, bucket)
  }
  return Array.from(groups.entries())
    .map(([name, groupFiles]) => ({
      name: name === 'root' ? '项目根目录' : `${name} 模块`,
      description: `覆盖 ${groupFiles.length} 个相关文件，用于帮助理解 ${name} 的职责与业务边界。`,
      files: groupFiles
    }))
    .sort((a, b) => b.files.length - a.files.length)
}

function buildDocumentContent(args: {
  projectName: string
  workingFolder: string
  documentName: string
  description: string
  files: string[]
  commitId: string | null
}): string {
  const fileList = args.files.map((file) => `- \`${file}\``).join('\n') || '- 无'
  return [
    `# ${args.documentName}`,
    '',
    args.description,
    '',
    '## 背景',
    `- 项目：${args.projectName}`,
    `- 工作目录：\`${args.workingFolder}\``,
    `- 生成 Commit：${args.commitId ?? '未知'}`,
    '',
    '## 主要职责',
    '- 该文档由当前项目源码结构自动归纳生成。',
    '- 当前版本为 V1 基础稿，后续可继续人工编辑并补充业务细节。',
    '',
    '## 关键文件',
    fileList,
    '',
    '## 业务说明',
    '请在这里补充该模块的业务目标、核心流程、上下游依赖、异常处理与边界条件。',
    '',
    '## 待完善',
    '- 补充真实业务流程',
    '- 标注关键入口、数据流和外部依赖',
    '- 沉淀容易误解的设计约束'
  ].join('\n')
}

function execGit(
  args: string[],
  cwd: string,
  sshConnectionId?: string | null
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (sshConnectionId) {
    const renderedArgs = args.map(shellEscape).join(' ')
    return execSshCommand(sshConnectionId, `git -C ${shellEscape(cwd)} ${renderedArgs}`)
  }

  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }))
    child.on('error', (error) => resolve({ stdout, stderr: error.message || stderr, exitCode: 1 }))
  })
}

function normalizeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function getHeadCommitId(
  workingFolder: string,
  sshConnectionId?: string | null
): Promise<string | null> {
  const result = await execGit(['rev-parse', 'HEAD'], workingFolder, sshConnectionId)
  if (result.exitCode !== 0) return null
  return result.stdout.trim() || null
}

async function getChangedFiles(
  workingFolder: string,
  baseCommitId: string,
  sshConnectionId?: string | null
): Promise<string[] | null> {
  const result = await execGit(
    ['diff', '--name-only', `${baseCommitId}..HEAD`],
    workingFolder,
    sshConnectionId
  )
  if (result.exitCode !== 0) return null
  return normalizeLines(result.stdout)
}

async function exportProjectWiki(
  projectId: string,
  workingFolder: string,
  sshConnectionId: string | null
): Promise<string[]> {
  const documents = wikiDao.listWikiLeafDocuments(projectId)
  const exportDir = joinWorkspacePath(workingFolder, sshConnectionId, DEFAULT_WIKI_EXPORT_DIR)
  if (sshConnectionId) {
    await execSshCommand(sshConnectionId, `mkdir -p ${shellEscape(exportDir)}`)
  } else {
    fs.mkdirSync(exportDir, { recursive: true })
  }
  const exportedPaths: string[] = []
  for (const document of documents) {
    const filePath = joinWorkspacePath(
      exportDir,
      sshConnectionId,
      `${document.slug || slugify(document.name)}.md`
    )
    if (sshConnectionId) {
      const encoded = Buffer.from(document.content_markdown, 'utf8').toString('base64')
      await execSshCommand(
        sshConnectionId,
        `printf %s ${shellEscape(encoded)} | base64 -d > ${shellEscape(filePath)}`
      )
    } else {
      fs.writeFileSync(filePath, document.content_markdown, 'utf8')
    }
    exportedPaths.push(filePath)
  }
  return exportedPaths
}

async function generateProjectWiki(
  projectId: string,
  mode: 'full' | 'regenerate' | 'incremental',
  changedFiles?: string[]
): Promise<
  | {
      error: string
    }
  | {
      documents: ReturnType<typeof wikiDao.listWikiDocuments>
      state: ReturnType<typeof wikiDao.getWikiProjectState>
      exportedPaths: string[]
      runId: string
    }
> {
  const project = projectsDao.getProject(projectId)
  if (!project?.working_folder) return { error: 'Project working folder is missing' }
  const workingFolder = project.working_folder
  const sshConnectionId = project.ssh_connection_id ?? null
  const files = changedFiles?.length
    ? changedFiles
    : await collectProjectFilesForTarget(workingFolder, sshConnectionId)
  const grouped = deriveModuleGroups(files)
  const headCommit = await getHeadCommitId(workingFolder, sshConnectionId)
  if (mode === 'regenerate') {
    wikiDao.clearWikiProject(projectId)
    const exportDir = joinWorkspacePath(workingFolder, sshConnectionId, DEFAULT_WIKI_EXPORT_DIR)
    if (sshConnectionId) {
      await execSshCommand(sshConnectionId, `rm -rf ${shellEscape(exportDir)}`)
    } else {
      fs.rmSync(exportDir, { recursive: true, force: true })
    }
  }
  wikiDao.saveWikiProjectState(projectId, {
    wikiEnabled: true,
    lastGenerationStatus: 'running',
    lastGenerationError: null
  })
  const run = wikiDao.createWikiGenerationRun({
    projectId,
    mode,
    status: 'running',
    changedFiles: files,
    affectedDocuments: grouped.map((item) => item.name)
  })
  const existingDocuments = wikiDao.listWikiDocuments(projectId)
  const affectedDocumentIds =
    mode === 'incremental' ? wikiDao.findWikiDocumentIdsBySourceFiles(projectId, files) : []
  const affectedIdSet = new Set(affectedDocumentIds)

  if (mode === 'incremental') {
    for (const existing of existingDocuments) {
      if (affectedIdSet.has(existing.id) && existing.status === 'edited') {
        wikiDao.saveWikiDocument({
          id: existing.id,
          projectId,
          name: existing.name,
          slug: existing.slug,
          description: existing.description,
          status: 'stale',
          contentMarkdown: existing.content_markdown,
          generationMode: existing.generation_mode,
          lastGeneratedCommitId: existing.last_generated_commit_id,
          preserveCreatedAt: true
        })
      }
    }
  }

  const summaryDocs = [
    {
      name: '项目总览',
      description: '帮助快速理解项目整体结构、模块分布和代码入口。',
      files: files.slice(0, Math.min(files.length, 40))
    },
    ...grouped.slice(0, 12)
  ]
  const savedDocuments = [] as Array<{ id: string; name: string; files: string[] }>
  for (const doc of summaryDocs) {
    if (mode === 'incremental' && doc.name !== '项目总览') {
      const matchedExisting = existingDocuments.find((item) => item.name === doc.name)
      if (matchedExisting && !affectedIdSet.has(matchedExisting.id)) {
        continue
      }
    }
    const matchedExisting = existingDocuments.find((item) => item.name === doc.name)
    if (mode === 'incremental' && matchedExisting?.status === 'stale') {
      savedDocuments.push({ id: matchedExisting.id, name: matchedExisting.name, files: doc.files })
      continue
    }
    const saved = wikiDao.saveWikiDocument({
      id: matchedExisting?.id,
      projectId,
      name: doc.name,
      slug: slugify(doc.name),
      description: doc.description,
      status: 'generated',
      contentMarkdown: buildDocumentContent({
        projectName: project.name,
        workingFolder,
        documentName: doc.name,
        description: doc.description,
        files: doc.files,
        commitId: headCommit
      }),
      generationMode: mode,
      lastGeneratedCommitId: headCommit,
      preserveCreatedAt: true
    })
    const sections = wikiDao.replaceWikiSections(saved.id, [
      {
        title: '关键文件',
        anchor: 'key-files',
        sortOrder: 0,
        summary: '该文档绑定的关键源码文件。',
        contentMarkdown: doc.files.map((file) => `- \`${file}\``).join('\n')
      }
    ])
    if (sections[0]) {
      wikiDao.replaceWikiSectionSources(
        sections[0].id,
        doc.files.map((filePath) => ({ filePath, reason: '自动生成时关联的关键文件' }))
      )
    }
    savedDocuments.push({ id: saved.id, name: saved.name, files: doc.files })
  }
  const exportedPaths = await exportProjectWiki(projectId, workingFolder, sshConnectionId)
  wikiDao.saveWikiProjectState(projectId, {
    wikiEnabled: true,
    lastGenerationStatus: 'completed',
    lastGenerationError: null,
    lastExportedAt: Date.now(),
    lastFullGeneratedCommitId: mode === 'incremental' ? undefined : headCommit,
    lastIncrementalGeneratedCommitId: mode === 'incremental' ? headCommit : undefined
  })
  wikiDao.updateWikiGenerationRun(run.id, {
    status: 'completed',
    affectedDocuments: savedDocuments.map((item) => item.name),
    outputSummary: `Generated ${savedDocuments.length} wiki documents and exported ${exportedPaths.length} files.`
  })
  return {
    documents: wikiDao.listWikiDocuments(projectId),
    state: wikiDao.getWikiProjectState(projectId),
    exportedPaths,
    runId: run.id
  }
}

export function registerWikiHandlers(): void {
  ipcMain.handle('db:wiki:get-document-detail', (_event, documentId: string) => {
    const document = wikiDao.getWikiDocument(documentId)
    if (!document) return null
    const sections = wikiDao.listWikiSections(documentId)
    const sectionsWithSources = sections.map((section) => ({
      ...section,
      sources: wikiDao.listWikiSectionSources(section.id)
    }))
    return { document, sections: sectionsWithSources }
  })

  ipcMain.handle('wiki:generate-full', async (_event, args: { projectId: string }) => {
    return await generateProjectWiki(args.projectId, 'full')
  })

  ipcMain.handle('wiki:regenerate', async (_event, args: { projectId: string }) => {
    return await generateProjectWiki(args.projectId, 'regenerate')
  })

  ipcMain.handle('wiki:generate-incremental', async (_event, args: { projectId: string }) => {
    const project = projectsDao.getProject(args.projectId)
    if (!project?.working_folder) return { error: 'Project working folder is missing' }
    const state = wikiDao.getWikiProjectState(args.projectId)
    const baseCommitId =
      state?.last_incremental_generated_commit_id ?? state?.last_full_generated_commit_id ?? null
    if (!baseCommitId) {
      return await generateProjectWiki(args.projectId, 'full')
    }
    const changedFiles = await getChangedFiles(
      project.working_folder,
      baseCommitId,
      project.ssh_connection_id ?? null
    )
    if (changedFiles === null) {
      return await generateProjectWiki(args.projectId, 'full')
    }
    if (changedFiles.length === 0) {
      return {
        documents: wikiDao.listWikiDocuments(args.projectId),
        state: wikiDao.getWikiProjectState(args.projectId),
        exportedPaths: [],
        skipped: true,
        reason: 'No changed files detected.'
      }
    }
    return await generateProjectWiki(args.projectId, 'incremental', changedFiles)
  })

  ipcMain.handle('wiki:get-head-commit', async (_event, args: { projectId: string }) => {
    const project = projectsDao.getProject(args.projectId)
    if (!project?.working_folder) return { commitId: null }
    const commitId = await getHeadCommitId(
      project.working_folder,
      project.ssh_connection_id ?? null
    )
    return { commitId }
  })

  ipcMain.handle(
    'wiki:get-changed-files',
    async (_event, args: { projectId: string; baseCommitId: string }) => {
      const project = projectsDao.getProject(args.projectId)
      if (!project?.working_folder) return { changedFiles: null }
      const changedFiles = await getChangedFiles(
        project.working_folder,
        args.baseCommitId,
        project.ssh_connection_id ?? null
      )
      return { changedFiles }
    }
  )

  ipcMain.handle('wiki:export-project', async (_event, args: { projectId: string }) => {
    const project = projectsDao.getProject(args.projectId)
    if (!project?.working_folder)
      return { exportedPaths: [], error: 'Project working folder is missing' }
    const exportedPaths = await exportProjectWiki(
      args.projectId,
      project.working_folder,
      project.ssh_connection_id ?? null
    )
    return { exportedPaths }
  })
}
