import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const uploadDir = path.resolve(__dirname, '..', '..', 'uploads')

function sameSubject(value, assigned) {
  return typeof value === 'string' && value.trim().toUpperCase() === assigned
}

export async function authorizeUpload(req, res, next) {
  const subject = req.user.subject?.trim().toUpperCase()
  if (!subject || !/^[A-Z0-9][A-Z0-9_-]*$/.test(subject)) {
    return res.status(403).json({ error: 'A valid faculty subject assignment is required.' })
  }
  if (req.query.subject !== undefined && !sameSubject(req.query.subject, subject)) {
    return res.status(403).json({ error: 'You may upload only to your assigned subject.' })
  }

  await fs.mkdir(uploadDir, { recursive: true })
  const root = await fs.realpath(uploadDir)
  let directory = root
  for (const segment of [subject.toLowerCase(), 'documents']) {
    directory = path.join(directory, segment)
    await fs.mkdir(directory, { recursive: true })
    if (await fs.realpath(directory) !== directory) {
      return res.status(403).json({ error: 'Invalid document directory.' })
    }
  }
  req.uploadDestination = { directory, subject }
  next()
}

const receiveFiles = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req.uploadDestination.directory),
    filename: (_req, _file, cb) => cb(null, randomUUID() + '.part'),
  }),
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname)),
}).fields([{ name: 'file', maxCount: 20 }, { name: 'files', maxCount: 20 }])

const indexingFiles = new Set()

async function publishBatch(files, targets) {
  // A single rename atomically replaces one PDF. For a batch, keep each old
  // file until every rename succeeds so a failed move can be rolled back.
  const published = []
  const backups = new Map()
  try {
    if (files.length > 1) {
      for (const target of targets) {
        const backup = path.join(path.dirname(target), randomUUID() + '.bak')
        try {
          await fs.link(target, backup)
          backups.set(target, backup)
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
        }
      }
    }
    for (const [i, target] of targets.entries()) {
      await fs.rename(files[i].path, target)
      files[i].path = target
      published.push(target)
    }
  } catch (err) {
    for (const target of published.reverse()) {
      const backup = backups.get(target)
      if (backup) {
        backups.delete(target) // Keep the backup available if restoration itself fails.
        await fs.rename(backup, target)
      } else {
        await fs.unlink(target)
      }
    }
    throw err
  } finally {
    for (const backup of backups.values()) await fs.unlink(backup)
  }
}

export const stageUpload = processUpload => (req, res, next) => {
  receiveFiles(req, res, async error => {
    if (error) return next(error) // Multer removes its partial files.
    const files = [...(req.files?.file || []), ...(req.files?.files || [])]
    const { directory, subject } = req.uploadDestination
    const staged = files.map(file => file.path)
    let reserved = []
    try {
      if (req.body?.subject !== undefined && !sameSubject(req.body.subject, subject)) {
        return res.status(403).json({ error: 'You may upload only to your assigned subject.' })
      }
      if (!files.length) return res.status(400).json({ error: 'No PDF file uploaded.' })
      const targets = files.map(file => {
        file.filename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')
        return path.resolve(directory, file.filename)
      })
      if (targets.some(target => path.dirname(target) !== directory)) {
        return res.status(400).json({ error: 'Invalid PDF filename.' })
      }
      const keys = targets.map(target => target.toLowerCase())
      if (new Set(keys).size !== keys.length || keys.some(key => indexingFiles.has(key))) {
        return res.status(409).json({ error: 'This PDF is already included in an upload.' })
      }
      reserved = keys
      for (const key of keys) indexingFiles.add(key)
      await publishBatch(files, targets)
      await processUpload(req, res)
    } catch (err) {
      next(err)
    } finally {
      for (const key of reserved) indexingFiles.delete(key)
      await Promise.all(staged.map(file => fs.rm(file, { force: true }).catch(err => console.warn('Upload cleanup failed:', err.message))))
    }
  })
}
