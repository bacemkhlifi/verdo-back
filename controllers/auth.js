const User = require("../models/User");
const Role = require("../models/Role");
const asyncHandler = require("../middleware/async");
const ErrorResponse = require("../utils/errorResponse");

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res, next) => {
  const { firstName, lastName, email, phoneNumber, password, entityType } =
    req.body;

  try {
    const user = await User.create({
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      entityType,
    });

    let defaultRole;

    if (entityType === "individual") {
      defaultRole = await Role.findOne({ name: "investor" });
    } else if (
      entityType === "group" ||
      entityType === "company" ||
      entityType === "organization"
    ) {
      defaultRole = await Role.findOne({ name: "landowner" });
    }

    if (defaultRole) {
      user.roles = [defaultRole._id];
      await user.save();
    }

    const populatedUser = await User.findById(user._id).populate("roles");
    sendTokenResponse(populatedUser || user, 200, res);
  } catch (err) {
    if (err.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern || {})[0];
      const errorKey =
        duplicateField === "email"
          ? "emailExists"
          : duplicateField === "phoneNumber"
          ? "phoneExists"
          : "registrationFailed";

      return res.status(400).json({
        success: false,
        errorKey,
        message: "A user with this information already exists.",
      });
    }

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        errorKey: "registrationFailed",
        message: Object.values(err.errors)
          .map((error) => error.message)
          .join(", "),
      });
    }

    console.error("Registration error:", err);
    return res.status(500).json({
      success: false,
      errorKey: "registrationFailed",
      message: "Server error during registration",
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/signin
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide an email and password",
      });
    }

    // Check for user and populate roles
    const user = await User.findOne({ email })
      .select("+password")
      .populate("roles");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (user.active === false) {
      return res.status(403).json({
        success: false,
        message: "This account is inactive",
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Create token
    // Remove password from response
    user.password = undefined;
    return sendTokenResponse(user, 200, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error during authentication",
      error: err,
    });
  }
};

exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).populate("roles");

  const permissions = user.getPermissions();

  const roleNames = user.roles.map((role) => role.name);

  res.status(200).json({
    success: true,
    data: {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      entityType: user.entityType,
      roles: roleNames,
      permissions: permissions,
    },
  });
});

exports.logout = asyncHandler(async (req, res, next) => {
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    data: {},
  });
});

const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();

  const options = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    sameSite: "lax",
  };

  if (process.env.NODE_ENV === "production") {
    options.secure = true;
  }

  // Make sure we have populated roles
  let roleNames = [];
  if (user.roles) {
    roleNames = user.roles.map((role) => {
      // Check if role is an object with a name property (populated) or just an ID
      return typeof role === "object" && role.name ? role.name : role;
    });
  }

  res
    .status(statusCode)
    .cookie("token", token, options)
    .json({
      success: true,
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        entityType: user.entityType,
        roles: roleNames,
        permissions: user.getPermissions ? user.getPermissions() : [],
      },
    });
};
