// 一次性脚本：删除 demo 资产（id 10000000-...0001~0006）在 asset-photos 中的真实图片文件
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const env = {};
for (const line of readFileSync(join(scriptDir, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match) env[match[1]] = match[2];
}

const DEMO_IDS = Array.from(
  { length: 6 },
  (_, i) => `10000000-0000-0000-0000-00000000000${i + 1}`,
);

const supabase = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL,
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
const { data: session, error: loginError } =
  await supabase.auth.signInWithPassword({
    email: env.EXPO_PUBLIC_ADMIN_EMAIL,
    password: env.EXPO_PUBLIC_ADMIN_PASSWORD,
  });
if (loginError) throw new Error(`登录失败: ${loginError.message}`);
const userId = session.user.id;

const { data: assets, error } = await supabase
  .from('assets')
  .select('id,name,photo_paths,photo_cutout_paths')
  .in('id', DEMO_IDS);
if (error) throw new Error(error.message);

const paths = assets.flatMap((asset) =>
  [
    ...asset.photo_paths,
    ...Object.values(asset.photo_cutout_paths ?? {}),
  ].filter((path) => path.startsWith(`${userId}/`)),
);
console.log(`找到 ${assets.length} 件 demo 资产，需删除的 storage 文件 ${paths.length} 个:`);
paths.forEach((path) => console.log(`  ${path}`));

if (paths.length) {
  const { error: removeError } = await supabase.storage
    .from('asset-photos')
    .remove(paths);
  if (removeError) throw new Error(`删除失败: ${removeError.message}`);
  console.log('storage 文件已删除');
}
await supabase.auth.signOut();
