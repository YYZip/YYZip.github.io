// Node.js 脚本：扫描 pages 目录生成 navigation.json
// 文件命名规则：1-folder/1.1-file.md（数字前缀用于排序）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAGES_DIR = path.join(__dirname, '..', '..', 'data', 'pages');
const OUTPUT_FILE = path.join(__dirname, '..', '..', 'data', 'navigation.json');

let lastHash = '';
let usedIds = new Set();

// 解析文件名，提取排序号和名称
function parseName(name) {
    const match = name.match(/^(\d+(?:\.\d+)?)-(.+?)(?:\.md)?$/);
    if (match) {
        return {
            order: parseFloat(match[1]),
            name: match[2],
            originalName: name
        };
    }
    return {
        order: 0,
        name: name.replace(/\.md$/, ''),
        originalName: name
    };
}

function generateId(relativePath) {
    const pathParts = relativePath.replace(/\.md$/, '').split('/');
    const idParts = pathParts.map(part => {
        const match = part.match(/^(\d+(?:\.\d+)?)-/);
        return match ? match[1].replace(/^0+/, '') : '';
    }).filter(Boolean);

    let uniqueId = idParts.length > 0 ? idParts.join('-') : 'id-' + crypto.randomUUID().slice(0, 8);
    let counter = 1;
    const baseId = uniqueId;

    while (usedIds.has(uniqueId)) {
        uniqueId = `${baseId}-${counter}`;
        counter++;
    }
    usedIds.add(uniqueId);
    return uniqueId;
}

function scanDirectory(dirPath, basePath = '', isTopLevel = false) {
    if (!fs.existsSync(dirPath)) {
        return { children: [], files: [] };
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = [];
    const filesList = [];

    const parsedItems = items.map(item => {
        const parsed = parseName(item.name);
        return {
            ...parsed,
            isDir: item.isDirectory(),
            fullPath: path.join(dirPath, item.name),
            relativePath: basePath ? `${basePath}/${item.name}` : item.name
        };
    });

    parsedItems.sort((a, b) => a.order - b.order);

    for (const item of parsedItems) {
        if (item.isDir) {
            const { children, files } = scanDirectory(item.fullPath, item.relativePath, false);
            filesList.push(...files);

            if (children.length > 0) {
                result.push({
                    id: generateId(item.relativePath),
                    name: item.name,
                    children
                });
            }
        } else if (item.originalName.endsWith('.md')) {
            filesList.push(item.relativePath);

            if (!isTopLevel) {
                result.push({
                    id: generateId(item.relativePath),
                    name: item.name,
                    file: item.relativePath
                });
            }
        }
    }

    return { children: result, files: filesList };
}

function computeHash(files) {
    return crypto.createHash('md5').update(files.sort().join('&')).digest('base64');
}

function detectHomeFile() {
    try {
        const files = fs.readdirSync(PAGES_DIR);
        const homeFiles = files.filter(file => file.startsWith('home-') && file.endsWith('.md'));

        if (homeFiles.length > 0) {
            const fileName = homeFiles[0];
            const homeName = fileName.replace('home-', '').replace('.md', '');
            return {
                file: fileName,
                name: homeName
            };
        }
    } catch (error) {
        console.error('检测首页文件失败:', error.message);
    }
    return {
        file: 'home.md',
        name: '首页'
    };
}

function generateNavigation() {
    try {
        if (!fs.existsSync(PAGES_DIR)) {
            fs.mkdirSync(PAGES_DIR, { recursive: true });
        }

        usedIds.clear();

        const { children: categories, files } = scanDirectory(PAGES_DIR, '', true);
        const currentHash = computeHash(files);

        if (currentHash === lastHash) {
            return false;
        }

        lastHash = currentHash;

        const homeInfo = detectHomeFile();

        const navigation = {
            home: homeInfo,
            categories
        };

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(navigation, null, 2), 'utf-8');
        const now = new Date().toLocaleTimeString();
        console.log(`[${now}] navigation.json 已更新，共 ${categories.length} 个顶级分类`);
        console.log(`[${now}] 首页文件: ${homeInfo.file}, 名称: ${homeInfo.name}`);
        return true;
    } catch (error) {
        console.error('生成导航失败:', error.message);
        return false;
    }
}

function start() {
    try {
        if (!fs.existsSync(PAGES_DIR)) {
            fs.mkdirSync(PAGES_DIR, { recursive: true });
        }

        generateNavigation();

        console.log(`正在监视: ${PAGES_DIR}`);
        console.log('按 Ctrl+C 退出');

        let debounceTimer = null;

        const watcher = fs.watch(PAGES_DIR, { recursive: true }, (eventType, filename) => {
            if (!filename) return;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (generateNavigation()) {
                    console.log(`检测到变化: ${filename}`);
                }
            }, 100);
        });

        watcher.on('error', (error) => {
            console.error(`监视错误: ${error.message}`);
        });

        process.on('SIGINT', () => {
            console.log('\n停止监视');
            watcher.close();
            process.exit(0);
        });
    } catch (error) {
        console.error('启动失败:', error.message);
        process.exit(1);
    }
}

module.exports = { generateNavigation, start };

if (require.main === module) {
    start();
}