import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ConfigCLIOptions {
  setPassword?: boolean;
  edit?: boolean;
  backup?: boolean;
  listBackups?: boolean;
  restore?: string;
  export?: string;
  import?: string;
  validate?: boolean;
}

/**
 * Config CLI command
 * Provides command-line interface for config management
 */
export async function configCLICommand(options: ConfigCLIOptions = {}): Promise<void> {
  const configPath = join(homedir(), ".ronin", "config.json");

  if (options.setPassword) {
    console.log(`
🔒 Config Editor Password

Current password is set via CONFIG_EDITOR_PASSWORD environment variable.

To change it:
1. Set the environment variable:
   export CONFIG_EDITOR_PASSWORD="your-new-password"

2. Restart Ronin to apply the change

Default password (if not set): "roninpass"

⚠️  Security Note:
- Use a strong password in production
- Never commit passwords to version control
- Consider using a password manager
    `);
    return;
  }

  if (options.edit) {
    console.log(`
📝 Opening Config Editor

The config editor is available at:
  http://localhost:3000/config

Default password: "roninpass" (unless changed via CONFIG_EDITOR_PASSWORD)

Features:
- Edit config via forms or raw JSON
- Automatic validation
- Backup/restore
- Hot-reload (agents auto-update)
    `);
    
    // Try to open browser
    try {
      const openCommand = process.platform === 'darwin' ? 'open' : 
                         process.platform === 'win32' ? 'start' : 'xdg-open';
      const { exec } = await import('child_process');
      exec(`${openCommand} http://localhost:3000/config`);
    } catch {
      // Browser opening is optional
    }
    return;
  }

  if (options.backup) {
    console.log('💾 Creating backup...');
    // Trigger backup via API
    try {
      const res = await fetch('http://localhost:3000/config/api/backup', {
        method: 'POST',
        headers: { 'Cookie': 'config_session=dummy' }
      });
      if (res.ok) {
        console.log('✅ Backup created successfully');
      } else {
        console.error('❌ Failed to create backup');
      }
    } catch {
      console.error('❌ Config editor not running. Start it with: bun run ronin start');
    }
    return;
  }

  if (options.listBackups) {
    console.log('📜 Listing backups...');
    try {
      const res = await fetch('http://localhost:3000/config/api/backups', {
        headers: { 'Cookie': 'config_session=dummy' }
      });
      if (res.ok) {
        const data = await res.json();
        console.log('\nBackups:');
        data.backups.forEach((backup: any) => {
          console.log(`  ${backup.id} - ${new Date(backup.timestamp).toLocaleString()}`);
          console.log(`    ${backup.description}`);
        });
      } else {
        console.error('❌ Failed to list backups');
      }
    } catch {
      console.error('❌ Config editor not running');
    }
    return;
  }

  if (options.restore) {
    console.log(`🔄 Restoring from backup: ${options.restore}`);
    try {
      const res = await fetch('http://localhost:3000/config/api/restore', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': 'config_session=dummy'
        },
        body: JSON.stringify({ backupId: options.restore })
      });
      if (res.ok) {
        console.log('✅ Config restored successfully');
      } else {
        const error = await res.json();
        console.error('❌ Restore failed:', error.error);
      }
    } catch {
      console.error('❌ Config editor not running');
    }
    return;
  }

  if (options.export) {
    console.log(`📤 Exporting config to: ${options.export}`);
    try {
      const res = await fetch('http://localhost:3000/config/api/current');
      if (res.ok) {
        const config = await res.json();
        const { writeFile } = await import('fs/promises');
        await writeFile(options.export!, JSON.stringify(config, null, 2));
        console.log('✅ Config exported successfully');
      }
    } catch {
      console.error('❌ Config editor not running');
    }
    return;
  }

  if (options.import) {
    console.log(`📥 Importing config from: ${options.import}`);
    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(options.import!, 'utf-8');
      const config = JSON.parse(content);
      
      const res = await fetch('http://localhost:3000/config/api/update', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': 'config_session=dummy'
        },
        body: JSON.stringify(config)
      });
      
      if (res.ok) {
        console.log('✅ Config imported successfully');
      } else {
        const error = await res.json();
        console.error('❌ Import failed:', error.errors || error.error);
      }
    } catch (err) {
      console.error('❌ Import failed:', err);
    }
    return;
  }

  if (options.validate) {
    console.log('✅ Validating config...');
    try {
      const res = await fetch('http://localhost:3000/config/api/validate');
      const result = await res.json();
      
      if (result.valid) {
        console.log('✅ Config is valid');
      } else {
        console.error('❌ Validation errors:');
        result.errors.forEach((err: string) => console.error(`  - ${err}`));
        process.exit(1);
      }
    } catch {
      console.error('❌ Config editor not running');
    }
    return;
  }

  // Default: show help
  console.log(`
⚙️  Ronin Config Manager

Usage: ronin config [options]

Options:
  --set-password        Show password configuration help
  --edit                Open config editor in browser
  --backup              Create manual backup
  --list-backups        List all backups
  --restore <id>        Restore from backup
  --export <path>       Export config to file
  --import <path>       Import config from file
  --validate            Validate current config

Environment:
  CONFIG_EDITOR_PASSWORD   Set password for config editor (default: "roninpass")

Web Interface:
  http://localhost:3000/config

Features:
  - Form-based editing with validation
  - Raw JSON editing
  - Automatic backups (keeps last 10)
  - Hot-reload (agents auto-update)
  - App directory auto-creation
  - Config versioning

Examples:
  # Open editor
  ronin config --edit

  # Create backup
  ronin config --backup

  # Export config
  ronin config --export ./my-config.json

  # Import and validate
  ronin config --import ./my-config.json
  `);
}
