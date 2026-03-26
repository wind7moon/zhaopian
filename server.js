const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// 公网部署时可在平台挂载「持久磁盘」，并把路径填到 UPLOAD_DIR，否则重启后上传会丢失
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");

// 确保上传目录存在
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

// 在反向代理（Nginx、Render、Fly 等）后面时，便于正确识别客户端 IP
app.set("trust proxy", 1);

// 前端静态资源（index.html/styles.css/app.js）
app.use(express.static(__dirname));

// 允许返回给前端的 JSON（避免前端猜测 Content-Type）
app.use(express.json());

// 供云平台健康检查（Render / Railway 等可填此路径）
app.get("/health", (_req, res) => {
  res.status(200).type("text").send("ok");
});

const isImageFile = (file) => file && file.mimetype && file.mimetype.startsWith("image/");

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    // 用时间戳 + uuid + 原后缀，降低重名概率并保留原类型后缀
    const ext = path.extname(file.originalname || "") || "";
    const safeExt = ext.replace(/[^.\w]/g, "");
    const base = path.basename(file.originalname || "", ext) || "photo";
    const safeBase = base.replace(/[^0-9a-zA-Z._-]/g, "_").slice(0, 60) || "photo";
    cb(null, `${Date.now()}_${uuidv4()}_${safeBase}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // 单张文件大小限制（你可以按需改大）
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!isImageFile(file)) return cb(new Error("Only image files are allowed."));
    cb(null, true);
  },
});

function readPhotosFromDisk() {
  const files = fs.readdirSync(UPLOAD_DIR);
  const photos = files
    .map((filename) => {
      const full = path.join(UPLOAD_DIR, filename);
      const stat = fs.statSync(full);
      // 文件名结构：{timestamp}_{uuid}_{safeBase}{ext}
      const name = filename.replace(/^\d+_[^_]+_/, "");
      return {
        id: filename, // 本地环境下 id 直接用文件名即可
        name,
        url: `/uploads/${encodeURIComponent(filename)}`,
        createdAt: stat.mtimeMs,
      };
    })
    .filter((p) => typeof p.url === "string");

  // 新的在前
  photos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return photos;
}

app.get("/api/photos", (_req, res) => {
  try {
    res.json({ ok: true, photos: readPhotosFromDisk() });
  } catch (e) {
    res.status(500).json({ ok: false, message: "读取图片失败" });
  }
});

app.post("/api/photos", upload.array("photos", 20), async (req, res) => {
  try {
    const files = req.files || [];
    const photos = files.map((f) => ({
      id: path.basename(f.filename),
      name: f.originalname || f.filename,
      url: `/uploads/${encodeURIComponent(path.basename(f.filename))}`,
      createdAt: Date.now(),
    }));
    res.json({ ok: true, photos });
  } catch (e) {
    res.status(400).json({ ok: false, message: e && e.message ? e.message : "上传失败" });
  }
});

app.delete("/api/photos", (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    for (const filename of files) {
      fs.unlinkSync(path.join(UPLOAD_DIR, filename));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: "清空失败" });
  }
});

// 简单错误处理（multer 抛错会走到这里）
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ ok: false, message: err && err.message ? err.message : "请求错误" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Photo viewer server listening on 0.0.0.0:${PORT}`);
});

