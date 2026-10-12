/**
 *  currently we dont have admin page to manage student and teacher accounts
 *  so we are feeding initial data
**/

import User from '../models/User.js';
import Subject from '../models/Subject.js';

export const DEMO_USERS = [
  { username: 'alice', password: '123', name: 'Alice', role: 'student', enrolled: ['DSA', 'ML', 'CN']},
  { username: 'bob', password: '123', name: 'Bob', role: 'student', enrolled: ['ML', 'CN']},
  { username: 'dsa', password: '123', name: 'Dr. Sarah', role: 'teacher', subject: 'DSA' },
  { username: 'ml', password: '123', name: 'Prof. Alan', role: 'teacher', subject: 'ML' },
  { username: 'cn', password: '123', name: 'Dr. Kevin', role: 'teacher', subject: 'CN' },
]

// 3. Initial Subjects (DSA, ML, CN)
export const DEMO_SUBJECTS = [
  {
    code: 'DSA',
    name: 'Data Structures & Algorithms',
    description: 'Master linear & non-linear structures, recursion, trees, graphs, sorting, and complexity analysis.',
    teacherUsername: 'teacher_dsa',
    teacherName: 'Dr. Sarah'
  },
  {
    code: 'ML',
    name: 'Machine Learning',
    description: 'Explore supervised & unsupervised learning, cost functions, gradient descent, neural networks, and evaluation.',
    teacherUsername: 'teacher_ml',
    teacherName: 'Prof. Alan'
  },
  {
    code: 'CN',
    name: 'Computer Networks',
    description: 'OSI & TCP/IP stack, routing protocols, flow control, congestion avoidance, sockets, and network security.',
    teacherUsername: 'teacher_cn',
    teacherName: 'Dr. Kevin'
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
