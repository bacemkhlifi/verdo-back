const express = require('express');
const {
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole
} = require('../controllers/roles');

const router = express.Router();

const { protect, authorize } = require('../middleware/auth');

router
  .route('/')
  .get(protect, authorize('admin'), getRoles)
  .post(protect, authorize('admin'), createRole);

router
  .route('/:id')
  .get(protect, authorize('admin'), getRole)
  .put(protect, authorize('admin'), updateRole)
  .delete(protect, authorize('admin'), deleteRole);

module.exports = router; 