import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import mongoose from 'mongoose'
import Prerequisite from '../models/Prerequisite.js'
import QuizAttempt from '../models/QuizAttempt.js'
import QuizSet from '../models/QuizSet.js'
import QuizState from '../models/QuizState.js'
import TopicMastery from '../models/TopicMastery.js'
import { completeQuiz, recordQuizSkip } from '../services/quizService.js'

// Run with node --test backend/test/quizSubmission.test.js and a local mongod.
test('quiz claims and learner updates survive retries on standalone MongoDB', async t => {
  const dbName = 'quiz_test_' + randomUUID().replaceAll('-', '')
  await mongoose.connect('mongodb://127.0.0.1:27017', { dbName, serverSelectionTimeoutMS: 3000 })
  t.after(async () => {
    assert.equal(mongoose.connection.name, dbName)
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  })
  await Promise.all([QuizAttempt, QuizSet, QuizState, TopicMastery, Prerequisite].map(model => model.init()))

  const scope = { studentUsername: 'fixture', subject: 'DSA' }
  const createQuiz = () => QuizSet.create({
    ...scope, conversationId: 'fixture-chat', query: 'Trees', explanation: 'Fixture lesson', topic: 'Trees',
    questions: [1, 2, 3].map(i => ({
      question: 'Fixture question ' + i, options: ['A', 'B', 'C', 'D'], correctAnswer: 'A',
    })),
  })
  const quiz = await createQuiz()
  const submission = {
    ...scope, quizSetIds: [quiz._id],
    answers: quiz.questions.map(q => ({ question_id: q.question_id, selectedAnswer: 'A' })),
  }
  await assert.rejects(completeQuiz({ ...submission, subject: 'ML' }), { status: 404 })
  await assert.rejects(completeQuiz({ ...submission, quizSetIds: [quiz._id, new mongoose.Types.ObjectId()] }), { status: 404 })
  assert.equal(await QuizState.countDocuments(), 0)

  await Prerequisite.create({ subject: 'DSA', topic: 'Trees', prerequisites: ['Nodes'] })
  const node = await TopicMastery.create({ ...scope, topic: 'Nodes', normalizedTopic: 'node', bestScore: 1, total: 1, pKnown: 0.6 })
  const interruption = t.mock.method(QuizAttempt, 'updateOne', () => { throw new Error('simulated interruption') })
  await assert.rejects(completeQuiz(submission), /simulated interruption/)
  interruption.mock.restore()
  const retries = await Promise.all([completeQuiz(submission), completeQuiz(submission)])
  assert.equal(String(retries[0].attempt._id), String(retries[1].attempt._id))
  assert.equal(retries[0].score, 3)
  assert.equal((await TopicMastery.findById(node._id)).pKnown, 0.632)
  assert.equal((await TopicMastery.findOne({ ...scope, normalizedTopic: 'tree' })).attemptsCount, 1)
  await assert.rejects(completeQuiz({ ...submission, answers: [] }), { status: 409 })

  const [a, b, c] = await Promise.all([createQuiz(), createQuiz(), createQuiz()])
  const submitBatch = pair => completeQuiz({ ...scope, quizSetIds: pair.map(q => q._id), answers: [] })
  const overlapping = await Promise.allSettled([submitBatch([a, b]), submitBatch([b, c])])
  assert.equal(overlapping.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(overlapping.find(r => r.status === 'rejected').reason.status, 409)
  const remaining = await QuizSet.findOne({ ...scope, status: 'pending' })
  assert.ok(remaining)
  const skip = () => recordQuizSkip(scope.studentUsername, scope.subject, remaining._id)
  await Promise.all([skip(), skip()])
  assert.equal((await QuizState.findOne(scope)).skipCount, 1)
  assert.equal(await QuizAttempt.countDocuments(), 2)
})
