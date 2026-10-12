import { Router } from 'express';
import { login, getDemoAccounts } from '../controllers/authController.js';

const router = Router();

router.post('/login', login);
router.get('/demo-accounts', getDemoAccounts);

export default router;
