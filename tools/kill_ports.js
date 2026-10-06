const { execSync } = require('child_process');

function killPort(port) {
    console.log(`[PortKiller] Attempting to free port ${port}...`);
    try {
        const output = execSync(`netstat -ano | findstr :${port}`).toString();
        const lines = output.split('\n');
        const pids = new Set();

        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 4) {
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
        });

        if (pids.size === 0) {
            console.log(`[PortKiller] Port ${port} is already free.`);
            return;
        }

        console.log(`[PortKiller] Found PIDs holding port ${port}: ${Array.from(pids).join(', ')}`);
        pids.forEach(pid => {
            try {
                execSync(`taskkill /F /PID ${pid}`);
                console.log(`[PortKiller] Killed PID ${pid}`);
            } catch (e) {
                // Ignore if process already died
            }
        });
        
        // Wait a second for Windows to actually release the socket
        execSync('timeout /t 1 /nobreak', { stdio: 'ignore' });
        console.log(`[PortKiller] Port ${port} should be free now.`);

    } catch (e) {
        // Silently fail if netstat finds nothing
    }
}

killPort(5173);
killPort(3001);
process.exit(0);
