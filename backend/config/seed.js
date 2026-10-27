/**
 *  currently we dont have admin page to manage student and teacher accounts
 *  so we are feeding initial data
**/

import User from '../models/User.js';
import Subject from '../models/Subject.js';
import bcrypt from 'bcrypt';

// Pre-hashed passwords for demo accounts (password: "123")
// Hash generated with bcrypt.genSalt(10) + bcrypt.hash("123", salt)
const HASHED_PASSWORD_123 = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export const DEMO_USERS = [
  { username: 'alice', password: HASHED_PASSWORD_123, name: 'Alice', role: 'student', enrolled: ['DSA', 'ML', 'CN', 'OS']},
  { username: 'bob', password: HASHED_PASSWORD_123, name: 'Bob', role: 'student', enrolled: ['ML', 'CN', 'OS']},
  { username: 'dsa', password: HASHED_PASSWORD_123, name: 'Dr. Sarah', role: 'teacher', subject: 'DSA' },
  { username: 'ml', password: HASHED_PASSWORD_123, name: 'Prof. Alan', role: 'teacher', subject: 'ML' },
  { username: 'cn', password: HASHED_PASSWORD_123, name: 'Dr. Kevin', role: 'teacher', subject: 'CN' },
  { username: 'os', password: HASHED_PASSWORD_123, name: 'Prof. Linus', role: 'teacher', subject: 'OS' },
]

// 3. Initial Subjects (DSA, ML, CN, OS)
export const DEMO_SUBJECTS = [
  {
    code: 'DSA',
    name: 'Data Structures & Algorithms',
    description: 'Master linear & non-linear structures, recursion, trees, graphs, sorting, and complexity analysis.',
    teacherUsername: 'dsa',
  },
  {
    code: 'ML',
    name: 'Machine Learning',
    description: 'Explore supervised & unsupervised learning, cost functions, gradient descent, neural networks, and evaluation.',
    teacherUsername: 'ml',
  },
  {
    code: 'CN',
    name: 'Computer Networks',
    description: 'OSI & TCP/IP stack, routing protocols, flow control, congestion avoidance, sockets, and network security.',
    teacherUsername: 'cn',
  },
  {
    code: 'OS',
    name: 'Operating Systems',
    description: 'Process management, concurrency, memory paging, virtual memory, storage, and file systems.',
    teacherUsername: 'os',
  },
]

export async function seedDatabase() {
  try {
    for (const user of DEMO_USERS) {
      await User.findOneAndUpdate(
        { username: user.username },
        { $set: user },
        { upsert: true }
      )
    }

    for (const subject of DEMO_SUBJECTS) {
      await Subject.findOneAndUpdate(
        { code: subject.code }, 
        { $set: subject }, 
        { upsert: true }
      )
    }
  } catch (err) {
    console.warn('Seeding error:', err.message)
  }
}
