const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Parser } = require('json2csv');
const cors = require('cors');
const socketIo = require('socket.io');
const http = require('http');

// Express setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.json());
app.use(cors());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/contactsDB', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

// User schema and model
const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    password: String
});
const User = mongoose.model('User', userSchema);

// Contact schema and model
const contactSchema = new mongoose.Schema({
    name: String,
    email: String,
    photo: String,
    tags: [String],
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const Contact = mongoose.model('Contact', contactSchema);

// Activity schema and model
const activitySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: String,
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
    timestamp: { type: Date, default: Date.now }
});
const Activity = mongoose.model('Activity', activitySchema);

// Multer setup for photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// User registration
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 8);
    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();
    res.json({ message: 'User registered' });
});

// User login
app.post('/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !bcrypt.compareSync(req.body.password, user.password)) {
        return res.status(401).send('Invalid credentials');
    }
    const token = jwt.sign({ userId: user._id }, 'secret_key');
    res.json({ token });
});

// Auth middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).send('Unauthorized');
    jwt.verify(token, 'secret_key', (err, decoded) => {
        if (err) return res.status(401).send('Unauthorized');
        req.userId = decoded.userId;
        next();
    });
};

// Contact management
app.get('/contacts', authMiddleware, async (req, res) => {
    const contacts = await Contact.find({ userId: req.userId });
    res.json(contacts);
});

app.post('/contacts', authMiddleware, upload.single('photo'), async (req, res) => {
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const newContact = new Contact({
        name: req.body.name,
        email: req.body.email,
        photo: photoUrl,
        tags: req.body.tags ? req.body.tags.split(',') : [],
        userId: req.userId
    });
    await newContact.save();

    // Log activity
    const activity = new Activity({ userId: req.userId, action: 'Added a new contact', contactId: newContact._id });
    await activity.save();

    io.to(req.userId).emit('updateContactList', newContact);
    res.json(newContact);
});

// Edit contact
app.put('/contacts/:id', authMiddleware, async (req, res) => {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).send('Contact not found');

    contact.name = req.body.name;
    contact.email = req.body.email;
    contact.tags = req.body.tags ? req.body.tags.split(',') : contact.tags;
    await contact.save();

    io.to(req.userId).emit('updateContactList', contact);
    res.json(contact);
});

// Delete contact
app.delete('/contacts/:id', authMiddleware, async (req, res) => {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ message: 'Contact deleted' });
});

// Real-time collaboration
io.on('connection', (socket) => {
    socket.on('joinRoom', (userId) => {
        socket.join(userId);
    });
});

// Export contacts to CSV
app.get('/contacts/export', authMiddleware, async (req, res) => {
    const contacts = await Contact.find({ userId: req.userId });
    const fields = ['name', 'email', 'tags'];
    const parser = new Parser({ fields });
    const csv = parser.parse(contacts);
    res.attachment('contacts.csv').send(csv);
});

// Start server
server.listen(5000, () => {
    console.log('Server running on port 5000');
});
