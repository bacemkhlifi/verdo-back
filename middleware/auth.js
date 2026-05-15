const jwt = require('jsonwebtoken');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {

    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.token) {

    token = req.cookies.token;
  }


  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findById(decoded.id).populate('roles');

    next();
  } catch (err) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }
});

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return next(new ErrorResponse('Not authorized to access this route', 403));
    }

    const userRoles = req.user.roles.map(role => role.name);
    
    const hasRole = roles.some(role => userRoles.includes(role));
    
    if (!hasRole) {
      return next(new ErrorResponse(`User role ${userRoles} is not authorized to access this route`, 403));
    }
    
    next();
  };
};

exports.checkPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ErrorResponse('Not authorized to access this route', 403));
    }

    const userPermissions = req.user.getPermissions();
    
    const hasPermission = permissions.some(permission => userPermissions.includes(permission));
    
    if (!hasPermission) {
      return next(new ErrorResponse('Not authorized to perform this action', 403));
    }
    
    next();
  };
}; 