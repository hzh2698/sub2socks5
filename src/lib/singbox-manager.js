import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

export class SingBoxManager {
  constructor() {
    this.process = null;
    this.logs = [];
    this.state = 'stopped';
  }

  async start(binaryPath, configPath) {
    await access(binaryPath);
    if (this.process) {
      await this.stop();
    }
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ['run', '-c', configPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.process = child;
      this.state = 'starting';
      child.stdout.on('data', (data) => this.pushLog(data.toString()));
      child.stderr.on('data', (data) => this.pushLog(data.toString()));
      child.once('spawn', () => {
        this.state = 'running';
        resolve();
      });
      child.once('error', (error) => {
        this.state = 'error';
        this.process = null;
        reject(error);
      });
      child.once('exit', (code) => {
        this.pushLog(`sing-box exited with code ${code}`);
        this.state = 'stopped';
        this.process = null;
      });
    });
  }

  async stop() {
    if (!this.process) {
      this.state = 'stopped';
      return;
    }
    const current = this.process;
    return new Promise((resolve) => {
      current.once('exit', () => resolve());
      current.kill();
    });
  }

  getStatus() {
    return {
      state: this.state,
      running: Boolean(this.process),
      logs: this.logs.slice(-200)
    };
  }

  pushLog(message) {
    const lines = message.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      this.logs.push(`${new Date().toISOString()} ${line}`);
    }
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }
}
