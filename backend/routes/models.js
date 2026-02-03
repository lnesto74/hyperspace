import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODELS_DIR = path.join(__dirname, '../models');

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Storage for single files (OBJ, GLB)
const singleFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MODELS_DIR);
  },
  filename: (req, file, cb) => {
    const objectType = req.params.type;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${objectType}${ext}`);
  }
});

// Storage for folder uploads (GLTF with textures)
const folderStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const objectType = req.params.type;
    const typeDir = path.join(MODELS_DIR, objectType);
    if (!fs.existsSync(typeDir)) {
      fs.mkdirSync(typeDir, { recursive: true });
    }
    
    // Preserve subdirectory structure from webkitRelativePath
    // The path comes like "rootFolder/subdir/file.png" - strip the root folder
    const relativePath = file.originalname;
    const parts = relativePath.split('/');
    
    // If path has multiple parts, strip root folder and preserve rest
    if (parts.length > 2) {
      // e.g., "mymodel/textures/image.png" -> "textures"
      const subPath = parts.slice(1, -1).join('/'); // Remove root folder and filename
      const fullDir = path.join(typeDir, subPath);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }
      cb(null, fullDir);
    } else {
      cb(null, typeDir);
    }
  },
  filename: (req, file, cb) => {
    // Use just the filename, not the full path
    const filename = path.basename(file.originalname);
    cb(null, filename);
  }
});

const uploadSingle = multer({
  storage: singleFileStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.obj' || ext === '.glb') {
      cb(null, true);
    } else {
      cb(new Error('Only .obj and .glb files are allowed for single upload'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadFolder = multer({
  storage: folderStorage,
  fileFilter: (req, file, cb) => {
    // Allow all files in GLTF folder (gltf, bin, textures)
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.ktx2'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(null, false); // Skip unknown files silently
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

export default function modelsRoutes(db) {
  const router = express.Router();

  // Get all custom models
  router.get('/', (req, res) => {
    try {
      const models = db.prepare('SELECT * FROM custom_models').all();
      res.json(models);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get model for specific object type
  router.get('/:type', (req, res) => {
    try {
      const { type } = req.params;
      const model = db.prepare('SELECT * FROM custom_models WHERE object_type = ?').get(type);
      if (model) {
        res.json(model);
      } else {
        res.status(404).json({ error: 'No custom model for this type' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload single file (OBJ, GLB) for object type
  router.post('/:type/upload', uploadSingle.single('model'), (req, res) => {
    try {
      const { type } = req.params;
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Clean up any existing folder for this type
      const typeDir = path.join(MODELS_DIR, type);
      if (fs.existsSync(typeDir)) {
        fs.rmSync(typeDir, { recursive: true });
      }

      const filePath = `/api/models/${type}/file`;
      
      // Upsert into database
      db.prepare(`
        INSERT INTO custom_models (object_type, file_path, original_name, uploaded_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(object_type) DO UPDATE SET
          file_path = excluded.file_path,
          original_name = excluded.original_name,
          uploaded_at = datetime('now')
      `).run(type, filePath, req.file.originalname);

      res.json({
        success: true,
        objectType: type,
        filePath,
        originalName: req.file.originalname
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload GLTF folder with textures
  router.post('/:type/upload-folder', (req, res, next) => {
    const { type } = req.params;
    
    // Clean up BEFORE multer processes - delete existing folder and single files
    const typeDir = path.join(MODELS_DIR, type);
    if (fs.existsSync(typeDir)) {
      fs.rmSync(typeDir, { recursive: true });
    }
    const extensions = ['.obj', '.glb'];
    for (const ext of extensions) {
      const singleFile = path.join(MODELS_DIR, `${type}${ext}`);
      if (fs.existsSync(singleFile)) {
        fs.unlinkSync(singleFile);
      }
    }
    
    next();
  }, uploadFolder.array('files', 100), (req, res) => {
    try {
      const { type } = req.params;
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      // Find the .gltf file to use as the main file
      const gltfFile = req.files.find(f => f.originalname.toLowerCase().endsWith('.gltf'));
      if (!gltfFile) {
        return res.status(400).json({ error: 'No .gltf file found in upload' });
      }

      const filePath = `/api/models/${type}/file`;
      const gltfFilename = path.basename(gltfFile.originalname);
      
      // Upsert into database
      db.prepare(`
        INSERT INTO custom_models (object_type, file_path, original_name, uploaded_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(object_type) DO UPDATE SET
          file_path = excluded.file_path,
          original_name = excluded.original_name,
          uploaded_at = datetime('now')
      `).run(type, filePath, gltfFilename);

      res.json({
        success: true,
        objectType: type,
        filePath,
        originalName: gltfFilename,
        fileCount: req.files.length
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve model file for object type
  router.get('/:type/file', (req, res) => {
    try {
      const { type } = req.params;
      
      // Check for folder-based GLTF first
      const typeDir = path.join(MODELS_DIR, type);
      if (fs.existsSync(typeDir) && fs.statSync(typeDir).isDirectory()) {
        // Find .gltf file in directory
        const files = fs.readdirSync(typeDir);
        const gltfFile = files.find(f => f.toLowerCase().endsWith('.gltf'));
        if (gltfFile) {
          res.setHeader('Content-Type', 'model/gltf+json');
          return res.sendFile(path.join(typeDir, gltfFile));
        }
      }
      
      // Check for single file formats
      const extensions = ['.glb', '.obj'];
      for (const ext of extensions) {
        const testPath = path.join(MODELS_DIR, `${type}${ext}`);
        if (fs.existsSync(testPath)) {
          const contentType = ext === '.glb' ? 'model/gltf-binary' : 'text/plain';
          res.setHeader('Content-Type', contentType);
          return res.sendFile(testPath);
        }
      }
      
      res.status(404).json({ error: 'Model file not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve static files from model folder (for textures)
  router.get('/:type/assets/*', (req, res) => {
    try {
      const { type } = req.params;
      const assetPath = req.params[0]; // Everything after /assets/
      const filePath = path.join(MODELS_DIR, type, assetPath);
      
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: 'Asset not found' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete custom model for object type
  router.delete('/:type', (req, res) => {
    try {
      const { type } = req.params;
      
      // Delete folder if exists
      const typeDir = path.join(MODELS_DIR, type);
      if (fs.existsSync(typeDir)) {
        fs.rmSync(typeDir, { recursive: true });
      }
      
      // Delete single files if exist
      const extensions = ['.obj', '.glb'];
      for (const ext of extensions) {
        const filePath = path.join(MODELS_DIR, `${type}${ext}`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      // Delete from database
      db.prepare('DELETE FROM custom_models WHERE object_type = ?').run(type);
      
      res.json({ success: true, objectType: type });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
