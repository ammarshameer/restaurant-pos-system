const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');

function resolveProvider() {
  const envProvider = (process.env.DATABASE_PROVIDER || '').trim().toLowerCase();
  if (envProvider === 'postgresql' || envProvider === 'postgres') {
    return 'postgresql';
  }
  if (envProvider === 'sqlite') {
    return 'sqlite';
  }

  const dbUrl = (process.env.DATABASE_URL || '').trim().toLowerCase();
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    return 'postgresql';
  }

  return 'sqlite';
}

function updateSchemaProvider() {
  if (!fs.existsSync(schemaPath)) {
    console.error(`[prepare-prisma] schema.prisma not found at: ${schemaPath}`);
    return;
  }

  const targetProvider = resolveProvider();
  let schema = fs.readFileSync(schemaPath, 'utf8');

  const datasourceRegex = /datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"[\s\S]*?\}/;
  const match = schema.match(datasourceRegex);

  if (match) {
    const currentProvider = match[1];
    if (currentProvider !== targetProvider) {
      console.log(`[prepare-prisma] 🔄 Switching Prisma datasource provider from "${currentProvider}" to "${targetProvider}"`);
      schema = schema.replace(
        datasourceRegex,
        (fullMatch) => fullMatch.replace(`provider = "${currentProvider}"`, `provider = "${targetProvider}"`)
      );
      fs.writeFileSync(schemaPath, schema, 'utf8');
      console.log(`[prepare-prisma] ✓ schema.prisma updated with provider "${targetProvider}"`);
    } else {
      console.log(`[prepare-prisma] ✓ Prisma provider is already set to "${targetProvider}"`);
    }
  } else {
    console.warn('[prepare-prisma] ⚠️ Could not locate datasource db block in schema.prisma');
  }
}

updateSchemaProvider();
