/*
 * 生成 hvigor 可解密的签名密码密文与配套 material 文件。
 *
 * 原理（逆向自 DevEco hvigor-ohos-plugin decipher-util.js）：
 *  - storeFile 同级需有 material/ 目录，含 fd(3 个 16 字节随机数组)、ac(salt)、ce(加密后的工作密钥)
 *  - rootKey = pbkdf2(utf8(k1^k2^k3^COMPONENT), salt, 10000, 16, sha256)
 *  - ce 内容 = AES-128-GCM(rootKey) 加密的 finalKey，格式: BE32(ivLen)+iv+ct+tag(16)
 *  - 密码字段 = AES-128-GCM(finalKey) 加密后的十六进制串，同样格式
 *
 * 用法: node gen_sign_material.js <密码>
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEYSTORE_DIR = __dirname;
const MATERIAL = path.join(KEYSTORE_DIR, "material");
const COMPONENT = Buffer.from([49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119]);

function placeFile(dir, data) {
  const sub = path.join(dir, crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, crypto.randomBytes(4).toString("hex")), data);
}

// fd 的每个条目必须是"含 1 个文件的子目录"；ac/ce 的条目必须直接是文件
function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// 与 hvigor decrypt() 对应的加密格式: BE32(ctLen+16) + iv(12) + ciphertext + tag(16)
function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(ct.length + 16);
  return Buffer.concat([head, iv, ct, cipher.getAuthTag()]);
}

function main() {
  const pwd = process.argv[2];
  if (!pwd) {
    console.error("usage: node gen_sign_material.js <password>");
    process.exit(1);
  }

  // fd: 3 个子目录各含 1 个 16 字节文件
  const keys = [crypto.randomBytes(16), crypto.randomBytes(16), crypto.randomBytes(16)];
  const fdDir = path.join(MATERIAL, "fd");
  resetDir(fdDir);
  keys.forEach((k) => placeFile(fdDir, k));

  // ac: salt（直接放文件）
  const salt = crypto.randomBytes(16);
  resetDir(path.join(MATERIAL, "ac"));
  fs.writeFileSync(path.join(MATERIAL, "ac", crypto.randomBytes(4).toString("hex")), salt);

  let xored = Buffer.alloc(16);
  for (const k of [...keys, COMPONENT]) {
    for (let i = 0; i < 16; i++) xored[i] ^= k[i];
  }
  const rootKey = crypto.pbkdf2Sync(xored.toString("utf8"), salt, 10000, 16, "sha256");

  const finalKey = crypto.randomBytes(16);
  const ceDir = path.join(MATERIAL, "ce");
  resetDir(ceDir);
  fs.writeFileSync(path.join(ceDir, crypto.randomBytes(4).toString("hex")), encrypt(rootKey, finalKey));

  const hex = encrypt(finalKey, Buffer.from(pwd, "utf8")).toString("hex");
  console.log(hex);
}

main();
