import { execFile } from 'node:child_process';
import { platform } from 'node:os';

/**
 * 本地系统通知。macOS 走 osascript，Linux 走 notify-send，Windows 走 PowerShell toast。
 * 失败静默忽略（跨平台兼容性优先于可靠性）。
 */

export interface LocalNotification {
  readonly title: string;
  readonly message: string;
}

export function sendLocalNotification(n: LocalNotification): void {
  const os = platform();
  try {
    if (os === 'darwin') {
      const script = `display notification ${JSON.stringify(n.message)} with title ${JSON.stringify(n.title)}`;
      execFile('osascript', ['-e', script], { timeout: 5000 }, () => {});
    } else if (os === 'linux') {
      execFile('notify-send', [n.title, n.message], { timeout: 5000 }, () => {});
    } else if (os === 'win32') {
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.MessageBox]::Show('${n.message.replace(/'/g, "''")}','${n.title.replace(/'/g, "''")}')`;
      execFile('powershell.exe', ['-Command', ps], { timeout: 5000 }, () => {});
    }
  } catch {
    // 静默忽略
  }
}
