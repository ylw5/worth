// 批量补图脚本：把本地图片上传到 asset-photos bucket 并回填 assets.photo_paths
// 用法：node scripts/backfill-photos.mjs [图片目录]
//   图片目录默认为仓库根的 img/，文件名（不含扩展名）需与资产 name 完全一致
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const imgDir = resolve(process.argv[2] ?? join(scriptDir, '..', '..', 'img'));

function loadEnv() {
  const content = readFileSync(join(scriptDir, '..', '.env.local'), 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

async function main() {
  const env = loadEnv();
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
  console.log(`已登录 ${session.user.email} (${userId})`);

  const { data: assets, error: listError } = await supabase
    .from('assets')
    .select('id,name,photo_paths');
  if (listError) throw new Error(`读取资产失败: ${listError.message}`);
  console.log(`共 ${assets.length} 件资产`);

  const files = readdirSync(imgDir).filter(
    (file) => CONTENT_TYPES[extname(file).toLowerCase()],
  );
  if (!files.length) throw new Error(`${imgDir} 下没有 jpg/png 图片`);

  const bucket = supabase.storage.from('asset-photos');
  let ok = 0;
  for (const file of files) {
    const name = basename(file, extname(file)).trim();
    const asset = assets.find((item) => item.name.trim() === name);
    if (!asset) {
      console.warn(`跳过 ${file}：没有名称为「${name}」的资产`);
      continue;
    }

    const extension = extname(file).toLowerCase() === '.png' ? 'png' : 'jpg';
    const path = `${userId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${extension}`;
    const { error: uploadError } = await bucket.upload(
      path,
      readFileSync(join(imgDir, file)),
      { contentType: CONTENT_TYPES[`.${extension}`], upsert: false },
    );
    if (uploadError) {
      console.error(`上传 ${file} 失败: ${uploadError.message}`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('assets')
      .update({
        photo_paths: [path],
        photo_cutout_paths: {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', asset.id);
    if (updateError) {
      await bucket.remove([path]).catch(() => undefined);
      console.error(`更新资产「${name}」失败: ${updateError.message}`);
      continue;
    }

    const { data: signed } = await bucket.createSignedUrl(path, 60);
    console.log(
      `✔ ${name}: ${asset.photo_paths?.join(',') || '(无)'} -> ${path}` +
        (signed?.signedUrl ? '（签名 URL 验证通过）' : '（签名 URL 验证失败！）'),
    );
    ok += 1;
  }
  console.log(`完成：成功补图 ${ok}/${files.length}`);
  await supabase.auth.signOut();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
