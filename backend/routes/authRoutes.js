import { Router } from 'express';
import { login, getDemoAccounts } from '../controllers/authController.js';
import { authRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login', authRateLimiter, login);
router.get('/demo-accounts', getDemoAccounts);

export default router;
