import { v4 as uuid } from 'uuid';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ApprovalPayload,
  ApprovalRequest,
  ApprovalType,
  BuildFile,
} from '@aether/shared';
import type { DataStore } from '../storage/store.js';

const execFileAsync = promisify(execFile);

export class ApprovalService {
  constructor(private store: DataStore) {}

  async createApproval(params: {
    type: ApprovalType;
    title: string;
    description: string;
    payload: ApprovalPayload;
    conversationId?: string;
    messageId?: string;
  }): Promise<ApprovalRequest> {
    const settings = await this.store.getSettings();

    const autoApprove =
      (params.type === 'build' && settings.alwaysApproveBuilds) ||
      (params.type === 'script' && settings.alwaysApproveScripts);

    const approval: ApprovalRequest = {
      id: uuid(),
      type: params.type,
      title: params.title,
      description: params.description,
      payload: params.payload,
      status: autoApprove ? 'approved' : 'pending',
      createdAt: new Date().toISOString(),
      conversationId: params.conversationId,
      messageId: params.messageId,
    };

    await this.store.saveApproval(approval);

    if (autoApprove) {
      await this.executeApproval(approval);
      approval.resolvedAt = new Date().toISOString();
      await this.store.saveApproval(approval);
    }

    return approval;
  }

  async resolveApproval(
    id: string,
    decision: 'approved' | 'denied',
  ): Promise<ApprovalRequest> {
    const approval = await this.store.getApproval(id);
    if (!approval) throw new Error('Approval not found');
    if (approval.status !== 'pending') return approval;

    approval.status = decision;
    approval.resolvedAt = new Date().toISOString();

    if (decision === 'approved') {
      await this.executeApproval(approval);
    }

    await this.store.saveApproval(approval);
    return approval;
  }

  private async executeApproval(approval: ApprovalRequest): Promise<void> {
    const { payload } = approval;
    const dataDir = (await this.store.getSettings()).dataDir;

    if (payload.files?.length) {
      await this.applyBuildFiles(payload.files, dataDir);
    }

    if (payload.command) {
      await this.runScript(payload.command, dataDir);
    }

    if (payload.toolDefinition) {
      const extDir = path.join(dataDir, 'extensions');
      const toolPath = path.join(extDir, `${payload.toolDefinition.name}.tool.json`);
      await fs.writeFile(toolPath, JSON.stringify(payload.toolDefinition, null, 2));
    }
  }

  private async applyBuildFiles(files: BuildFile[], dataDir: string): Promise<void> {
    const buildDir = path.join(dataDir, 'builds');
    await fs.mkdir(buildDir, { recursive: true });

    for (const file of files) {
      const fullPath = path.join(buildDir, file.path);
      if (file.action === 'delete') {
        try {
          await fs.unlink(fullPath);
        } catch {
          /* ignore */
        }
        continue;
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf-8');
    }
  }

  private async runScript(command: string, dataDir: string): Promise<string> {
    const scriptsDir = path.join(dataDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });

    const { stdout, stderr } = await execFileAsync(
      process.platform === 'win32' ? 'powershell.exe' : 'sh',
      process.platform === 'win32' ? ['-Command', command] : ['-c', command],
      {
        cwd: scriptsDir,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    return stdout || stderr;
  }
}