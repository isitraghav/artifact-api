const requestIp = require("request-ip");
const { PrismaClient } = require("./prisma/generated/client");
const prisma = new PrismaClient();
const { rateLimit } = require("express-rate-limit");
const express = require("express");
const { default: axios } = require("axios");
const cache = require("memory-cache");
const app = express();
const cors = require("cors");
var _ = require("underscore");

app.use(require("sanitize").middleware);
app.use(express.json());
app.use(
  cors({
    origin: "*",
    allowedHeaders: "*",
    preflightContinue: true,
  })
);

app.set("trust proxy", 1);
app.get("/ip", (request, response) => response.json({ ip: request.ip }));

app.all("/", function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

app.get("/api/cache", async (req, res) => {
  let data = req.query;
  if (_.has(data, "pub")) {
    cache.del(data.pub);
  }
  res.json({});
});

app.get("/api/clearallcache", async (req, res) => {
  let data = req.query;
  if (_.has(data, "pass")) {
    if (data.pass == "Raghav1979") {
      res.json(JSON.parse(cache.exportJson()));
      cache.clear();
      return;
    }
  }
  res.json({
    m: "wrong or no password",
  });
});

app.post("/api/geo", async (req, res) => {
  try {
    const detectedIp = requestIp.getClientIp(req);
    let body = req.body;
    console.log(body);
    console.log(_.has(body, "lat"));
    if (_.has(body, "lat") == false) {
      let cache_prev = cache.get(body.pub);
      if (cache_prev) {
        console.log("cache hit(low)");
        res.status(200).json(cache_prev);
      } else {
        console.log("cache miss(low)");
        await axios.get("http://ip-api.com/json/" + detectedIp).then((r) => {
          let data = r.data;
          let datapro = {
            state: data.city,
            country: data.country,
          };
          if (_.has(data, "city") && _.has(data, "country")) {
            cache.put(body.pub, datapro, 0.5 * 1000 * 60 * 60);
          }
          res.status(200).json(datapro);
        });
      }
      return;
    }
    let cache_prev = cache.get(body.pub);
    if (cache_prev) {
      console.log("cache hit!");
      res.status(200).json(cache_prev);
    } else {
      console.log("cache miss!");
      let url = `https://geocode.maps.co/reverse?lat=${body.lat}&lon=${body.long}`;
      await axios.get(url).then(async (resp) => {
        res.json(resp.data["address"]);
        cache.put(body.pub, resp.data["address"], 1 * 1000 * 60 * 60);
        let selection = await prisma.ipLog.findUnique({
          where: {
            ip: detectedIp,
          },
        });
        if (!selection) {
          const result = await prisma.ipLog.create({
            data: {
              ip: detectedIp,
              pub: body.pub,
              lat: String(body.lat),
              long: String(body.long),
            },
          });
          console.log(result);
          console.log("creating new record!");
        } else {
          if (
            selection.lat !== body.lat ||
            selection.long !== body.long ||
            selection.pub !== body.pub
          ) {
            console.log(selection);
            console.log("updating record!");
            const result = await prisma.ipLog.update({
              data: {
                ip: detectedIp,
                pub: body.pub,
                lat: String(body.lat),
                long: String(body.long),
              },
              where: {
                ip: detectedIp,
              },
            });
            console.log(result);
          }
        }
      });
    }
    prisma.$disconnect();
  } catch (error) {
    res.json(error);
  }
});

app.get("/api/search", async (req, res) => {
  const data = req.query;
  if (_.has(data, "q")) {
    if (!/^[A-Za-z0-9 ]*$/.test(data.q)) {
      res.status(403).json({ m: "use only numbers and alphabets" });
      return;
    }
    if (data.q !== "" && data.q.length >= 3) {
      console.log(data);
      async function getresult() {
        return new Promise(async (resolve, reject) => {
          const result = await prisma.post.findMany({
            where: {
              OR: [
                {
                  content: {
                    contains: data.q,
                  },
                },
                {
                  heading: {
                    contains: data.q,
                  },
                },
              ],
            },
          });
          resolve(result);
        });
      }
      let cached = cache.get(data.q);
      if (cached) {
        res.status(200).json({ data: cached });
        let result = await getresult();
        if (result !== cached) {
          cache.put(data.q, result, 0.3 * 1000 * 60 * 60);
        }
      } else {
        try {
          let result = await getresult();
          cache.put(data.q, result, 0.3 * 1000 * 60 * 60);
          res.status(200).json({ data: result });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
      await prisma.$disconnect();
    } else {
      res.status(403).json({
        m: "3 or more characters to search",
      });
    }
  }
});

app.post("/api/submit", async (req, res) => {
  const data = req.body;
  await prisma.post
    .create({
      data: {
        content: data.content,
        heading: data.heading,
        pub: data.pub,
        uid: data.uid,
        images: JSON.stringify(data.images),
      },
    })
    .then((a) => {
      console.log(a);
    });

  res.status(200).json({ m: "success" });
  await prisma.$disconnect();
});

app.listen(process.env.PORT || 3000);

module.exports = app;
