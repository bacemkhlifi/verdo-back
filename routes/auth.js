const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  logout
} = require('../controllers/auth');
const { protect } = require('../middleware/auth');

router.post('/signup', register);
router.post('/signin', login);
router.get('/me', protect, getMe);
router.get('/logout', logout);

module.exports = router; 