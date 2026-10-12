import fs from 'node:fs/promises'
import path from 'node:path'
import { uploadDir } from '../middleware/upload.js'

export async function filesystemDocuments(subject = null) {
  let entries = []
  try {
    entries = await fs.readdir(uploadDir, { withFileTypes: true })
  } catch {
    return []
  }

  const allFiles = []

  // 1. Collect PDFs from subject subfolders (e.g. uploads/os/documents/ and uploads/os/)
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'images') {
      const subSubject = entry.name.toUpperCase()
      const seenNames = new Set()

      // 1a. Primary location: uploads/{subject}/documents/*.pdf
      try {
        const docDir = path.join(uploadDir, entry.name, 'documents')
        const docEntries = await fs.readdir(docDir, { withFileTypes: true })
        for (const sub of docEntries) {
          if (sub.isFile() && sub.name.toLowerCase().endsWith('.pdf')) {
            seenNames.add(sub.name)
            allFiles.push({
              name: sub.name,
              fullPath: path.join(docDir, sub.name),
              subject: subSubject,
            })
          }
        }
      } catch {}

      // 1b. Legacy location: uploads/{subject}/*.pdf
      try {
        const subEntries = await fs.readdir(path.join(uploadDir, entry.name), { withFileTypes: true })
        for (const sub of subEntries) {
          if (sub.isFile() && sub.name.toLowerCase().endsWith('.pdf') && !seenNames.has(sub.name)) {
            allFiles.push({
              name: sub.name,
              fullPath: path.join(uploadDir, entry.name, sub.name),
              subject: subSubject,
            })
          }
        }
      } catch {}
    }
  }

  // 2. Fallback check for any PDFs directly in root uploadDir
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      const lower = entry.name.toLowerCase()
      let detected = 'UNKNOWN'
      if (lower.includes('ml') || lower.includes('machine')) detected = 'ML'
      else if (lower.includes('cn') || lower.includes('network')) detected = 'CN'
      else if (lower.includes('os') || lower.includes('operating')) detected = 'OS'
      else if (lower.includes('dsa') || lower.includes('algorithm')) detected = 'DSA'
      allFiles.push({
        name: entry.name,
        fullPath: path.join(uploadDir, entry.name),
        subject: detected,
      })
    }
  }
  const filtered = subject
    ? allFiles.filter(item => item.subject.toUpperCase() === subject.toUpperCase())
    : allFiles

  return Promise.all(filtered.map(async item => {
    const stats = await fs.stat(item.fullPath)
    return {
      id: item.name,
      name: item.name,
      size: stats.size,
      subject: item.subject,
      uploadedAt: stats.mtime.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      status: 'Indexed',
    }
  }))
}
