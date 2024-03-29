const express = require("express");
const app = express();
const cors = require("cors");
var jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");
const port = process.env.PORT || 3000;
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_KEY);

//middleware
app.use(cors());
app.use(express.json());

console.log(process.env.OPEN_AI_KEY);
console.log(process.env.DB_PASSWORD);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.sayatpw.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function sendBookingEmail(booking) {
  const { email, treatment, appointmentDate, slot } = booking;

  const auth = {
    auth: {
      api_key: process.env.EMAIL_SEND_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN,
    },
  };

  const transporter = nodemailer.createTransport(mg(auth));

  transporter.sendMail(
    {
      from: "rahulhasan666@gmail.com", // verified sender email
      to: email, // recipient email
      subject: `Your appointment For ${treatment} is confirm`, // Subject line
      text: "Hello world!", // plain text body
      html: `
  <>
  <h2>Your appointment</h2>
  <div>
  <p>Your appointment for treatment${treatment}</p>
  <P>please visit us on ${appointmentDate} at ${slot}</p>
  <p>thanks for doctors portal</P>
  </div>
  
  </>
  
  `, // html body
    },
    function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    }
  );
}
function verifyJWT(req, res, next) {
  console.log("jwt", req.headers.authorization);
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorized access");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(401).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("doctors")
      .collection("appointmentOption");

    const bookingsCollection = client.db("doctors").collection("bookings");

    const usersCollection = client.db("doctors").collection("users");

    const doctorsCollection = client.db("doctors").collection("doctorsDetails");
    const paymentsCollection = client.db("doctors").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      console.log(req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden acess" });
      }

      next();
    };

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateResult = await bookingsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });
    app.get("/appointmentsOption", async (req, res) => {
      const date = req.query.date;
      console.log(date);
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      // code carefully
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });
      res.send(options);
    });

    //  app.get('/v2/appointmentsOption', async(req, res)=>{
    //   const date= req.query.date
    //   const options= await appointmentOptionCollection.aggregate([
    //     {
    //       $lookup:{
    //         from:"bookings",
    //         localField: "name",
    //         foreignField:"treatment",
    //         pipeline:[{
    //           $match:{
    //             $expr:{
    //               $eq:['$appointmentDate', date]
    //             }
    //           }
    //         }],
    //         as:'booked'

    //       }
    //     },
    //     {
    //       $project:{
    //         name:1,
    //         slots:1,
    //         booked :{
    //           $map:{
    //             input:'$booked',
    //             as:'book',
    //             in:'$book.slot'
    //           }
    //         }
    //       }
    //     },
    //     {
    //       $project:{
    //         name:1,
    //         slots:{
    //           $setDifference:['slots', "$booked"]
    //         }
    //       }
    //     }
    //   ]).toArray()
    //   res.send(options)
    //  })
    // * app.get('/bookings')
    // * app.get('/bookings/id')
    // * app.post('/bookings)
    // * app.patch('/bookings/id)
    // * app.delete('/bookings/id)

    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You already a Booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingsCollection.insertOne(booking);
      // send email
      sendBookingEmail(booking);
      res.send(result);
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }

      res.status(401).send({ accessToken: "" });
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      console.log(user);
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const option = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc, option);
      res.send(result);
    });

    app.post("/doctorsDetails", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = req.body;
      const result = await doctorsCollection.insertOne(doctors);
      res.send(result);
    });

    app.get("/doctorsDetails", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result);
    });

    app.delete(
      "/doctorsDetails/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: ObjectId(id) };
        const result = await doctorsCollection.deleteOne(filter);
        res.send(result);
      }
    );

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
  } finally {
  }
}

run().catch((e) => console.log(e));

app.get("/", async (req, res) => {
  res.send("hello doctor sir");
});

app.listen(port, () => console.log(`server running ${port}`));
