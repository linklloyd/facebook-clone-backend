import multer from "multer";
import path from "path";

// Memory storage — files are kept as Buffer in req.file.buffer
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const imageTypes = /jpeg|jpg|png|gif|webp/;
  const videoTypes = /mp4|mov|avi|webm|mkv|quicktime/;
  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  const mime = file.mimetype.toLowerCase();

  const isImage = imageTypes.test(ext) || imageTypes.test(mime);
  const isVideo = videoTypes.test(ext) || mime.startsWith("video/");

  cb(null, isImage || isVideo);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit per file
});

export default upload;
