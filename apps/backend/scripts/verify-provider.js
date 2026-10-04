const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');
const expected = (process.argv[2] || 'sqlite').trim().toLowerCase();

if (!fs.existsSync(schemaPath)) {
  console.error(`❌ [VERIFY-PROVIDER] schema.prisma not found at: ${schemaPath}`);
  process.exit(1);
}

const content = fs.readFileSync(schemaPath, 'utf8');
const match = content.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"[\s\S]*?\}/);

if (!match) {
  console.error('❌ [VERIFY-PROVIDER] Could not find datasource provider in schema.prisma');
  process.exit(1);
}

const current = match[1].toLowerCase();
if (current !== expected) {
  console.error(`\n❌ [CRITICAL BUILD FAILURE] Prisma provider mismatch!`);
  console.error(`   Expected: "${expected}"`);
  console.error(`   Actual:   "${current}" in ${schemaPath}`);
  console.error(`   Refusing to proceed with build to prevent packaging mismatched database runtime.\n`);
  process.exit(1);
}

console.log(`✓ [VERIFY-PROVIDER] Verified schema.prisma is correctly configured for provider = "${expected}"`);
