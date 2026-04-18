const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Please add a first name']
  },
  lastName: {
    type: String,
    required: [true, 'Please add a last name']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phoneNumber: {
    type: String,
    required: [true, 'Please add a phone number']
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  entityType: {
    type: String,
    enum: ['individual', 'company', 'organization', 'group'],
    required: [true, 'Please specify entity type']
  },
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  }],
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.getSignedJwtToken = function() {
  return jwt.sign(
    { id: this._id }, 
    process.env.JWT_SECRET, 
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.getPermissions = function() {
  let permissions = [];
  
  // If user has admin role, grant all permissions
  if (this.roles && this.roles.some(role => 
      (typeof role === 'object' && role.name === 'admin') || 
      (typeof role === 'string' && role === 'admin'))) {
    return [
      'manage_users',
      'manage_roles',
      'manage_products',
      'manage_investments',
      'view_dashboard',
      'view_reports',
      'view_opportunities',
      'make_investments',
      'view_own_investments',
      'manage_own_properties',
      'view_own_projects'
    ];
  }
  
  // Otherwise, collect permissions from roles
  if (this.roles && this.roles.length > 0) {
    this.roles.forEach(role => {
      if (role.permissions && role.permissions.length > 0) {
        permissions = [...permissions, ...role.permissions];
      }
    });
  }
  
  return [...new Set(permissions)];
};

module.exports = mongoose.model('User', UserSchema); 