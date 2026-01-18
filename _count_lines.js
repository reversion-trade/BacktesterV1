
const fs = require('fs');
const path = require('path');

function countLines(dir) {
    let totalLines = 0;
    let fileCount = 0;

    function walk(directory) {
        if (!fs.existsSync(directory)) return;
        const files = fs.readdirSync(directory);
        for (const file of files) {
            const fullPath = path.join(directory, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    walk(fullPath);
                } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    totalLines += content.split('\n').length;
                    fileCount++;
                }
            } catch (e) { }
        }
    }

    walk(dir);
    return { totalLines, fileCount };
}

try {
    const { totalLines, fileCount } = countLines('src');
    fs.writeFileSync('_count_result.txt', `LOC: ${totalLines}\nFiles: ${fileCount}`);
} catch (e) {
    fs.writeFileSync('_count_result.txt', `Error: ${e.message}`);
}
