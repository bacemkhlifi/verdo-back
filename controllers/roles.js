const Role = require('../models/Role');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

exports.getRoles = asyncHandler(async (req, res, next) => {
  const roles = await Role.find();
  
  res.status(200).json({
    success: true,
    count: roles.length,
    data: roles
  });
});

exports.getRole = asyncHandler(async (req, res, next) => {
  const role = await Role.findById(req.params.id);
  
  if (!role) {
    return next(new ErrorResponse(`Role not found with id of ${req.params.id}`, 404));
  }
  
  res.status(200).json({
    success: true,
    data: role
  });
});

exports.createRole = asyncHandler(async (req, res, next) => {
  const role = await Role.create(req.body);
  
  res.status(201).json({
    success: true,
    data: role
  });
});

exports.updateRole = asyncHandler(async (req, res, next) => {
  let role = await Role.findById(req.params.id);
  
  if (!role) {
    return next(new ErrorResponse(`Role not found with id of ${req.params.id}`, 404));
  }
  
  role = await Role.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });
  
  res.status(200).json({
    success: true,
    data: role
  });
});

exports.deleteRole = asyncHandler(async (req, res, next) => {
  const role = await Role.findById(req.params.id);
  
  if (!role) {
    return next(new ErrorResponse(`Role not found with id of ${req.params.id}`, 404));
  }
  
  await role.remove();
  
  res.status(200).json({
    success: true,
    data: {}
  });
}); 