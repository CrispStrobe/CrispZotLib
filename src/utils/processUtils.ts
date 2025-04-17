// modules/processUtils.ts
export class ProcessUtils {
  /**
   * Execute a command with proper cross-platform support
   */
  static async executeCommand(command: string, args: string[]): Promise<{ 
    exitCode: number, 
    result: string, 
    stderr: string 
  }> {
    return new Promise((resolve, reject) => {
      try {
        // Create file for the command
        const file = Components.classes["@mozilla.org/file/local;1"]
          .createInstance(Components.interfaces.nsIFile);
        
        let finalCommand = command;
        let finalArgs = [...args];
        
        // Handle system commands without paths
        if (!command.includes('/') && !command.includes('\\')) {
          if (Zotero.isWin) {
            file.initWithPath('C:\\Windows\\System32\\cmd.exe');
            finalArgs = ['/c', command, ...args];
            finalCommand = 'C:\\Windows\\System32\\cmd.exe';
          } else {
            file.initWithPath('/bin/sh');
            const cmdString = `${command} ${args.join(' ')}`;
            finalArgs = ['-c', cmdString];
            finalCommand = '/bin/sh';
          }
        } else {
          file.initWithPath(finalCommand);
        }
        
        // Create process
        const process = Components.classes["@mozilla.org/process/util;1"]
          .createInstance(Components.interfaces.nsIProcess);
        
        process.init(file);
        
        // Create pipes for stdout and stderr
        const stdout = Components.classes["@mozilla.org/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stdout.init(false, false, 0, 0, null);
        
        const stderr = Components.classes["@mozilla.org/pipe;1"]
          .createInstance(Components.interfaces.nsIPipe);
        stderr.init(false, false, 0, 0, null);
        
        // Run process
        process.run(false, finalArgs, finalArgs.length, stdout.outputStream, stderr.outputStream);
        
        // Read output
        const stdoutData = this.readFromPipe(stdout.inputStream);
        const stderrData = this.readFromPipe(stderr.inputStream);
        
        // Poll for completion
        const checkInterval = setInterval(() => {
          if (!process.isRunning) {
            clearInterval(checkInterval);
            resolve({
              exitCode: process.exitValue,
              result: stdoutData.join(""),
              stderr: stderrData.join("")
            });
          }
        }, 100);
      } catch (e) {
        reject(e);
      }
    });
  }
  
  private static readFromPipe(inputStream: any): string[] {
    const data = [];
    const stream = Components.classes["@mozilla.org/scriptableinputstream;1"]
      .createInstance(Components.interfaces.nsIScriptableInputStream);
    stream.init(inputStream);
    
    let available;
    while ((available = inputStream.available()) > 0) {
      data.push(stream.read(available));
    }
    
    return data;
  }
}