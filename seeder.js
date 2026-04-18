const mongoose = require('mongoose');
const dotenv = require('dotenv');
const colors = require('colors');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is not defined in environment variables'.red.bold);
  console.log('Please create a .env file with MONGO_URI=your_mongodb_connection_string');
  process.exit(1);
}

const Role = require('./models/Role');
const User = require('./models/User');

console.log(`Connecting to MongoDB: ${process.env.MONGO_URI}`.cyan);
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'.green.bold))
  .catch(err => {
    console.error('MongoDB Connection Error:'.red.bold, err);
    process.exit(1);
  });

const roles = [
  {
    name: 'admin',
    description: 'Administrator with full access',
    permissions: [
      'manage_users',
      'manage_roles',
      'manage_products',
      'manage_investments',
      'view_dashboard',
      'view_reports'
    ]
  },
  {
    name: 'investor',
    description: 'Investor role',
    permissions: [
      'view_opportunities',
      'make_investments',
      'view_own_investments',
      'view_dashboard'
    ]
  },
  {
    name: 'landowner',
    description: 'Landowner role',
    permissions: [
      'manage_own_properties',
      'view_own_projects',
      'view_dashboard'
    ]
  }
];

const adminUser = {
  firstName: 'Admin',
  lastName: 'User',
  email: 'admin@example.com',
  phoneNumber: '1234567890',
  password: 'password123',
  entityType: 'individual'
};

const importData = async () => {
  try {
    await Role.deleteMany();
    
    const createdRoles = await Role.create(roles);
    
    console.log('Roles imported...'.green.inverse);
    
    const adminRole = createdRoles.find(role => role.name === 'admin');
    
    let admin = await User.findOne({ email: adminUser.email });
    
    if (!admin) {
      admin = await User.create({
        ...adminUser,
        roles: [adminRole._id]
      });
      
      console.log('Admin user created...'.green.inverse);
    } else {
      admin.roles = [adminRole._id];
      await admin.save();
      
      console.log('Admin user updated...'.green.inverse);
    }
    
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

const deleteData = async () => {
  try {
    await Role.deleteMany();
    console.log('Roles destroyed...'.red.inverse);
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

if (process.argv[2] === '-i') {
  importData();
} else if (process.argv[2] === '-d') {
  deleteData();
} else {
  console.log('Please add an option: -i (import) or -d (delete)');
  process.exit();
} 