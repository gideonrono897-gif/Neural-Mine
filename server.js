require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BOTS = {
  Standard:{price:5,xp:50},
  Bronze:{price:15,xp:120},
  Silver:{price:50,xp:300},
  Gold:{price:100,xp:600},
  "Community I":{price:300,xp:1200},
  "Community II":{price:500,xp:2000}
};

// REGISTER
app.post('/api/register', async(req,res)=>{
  const hash = await bcrypt.hash(req.body.password,10);
  await supabase.from('users').insert([{email:req.body.email,password:hash}]);
  res.json({ok:true});
});

// LOGIN
app.post('/api/login', async(req,res)=>{
  const {data} = await supabase.from('users')
    .select('*').eq('email',req.body.email).single();

  const valid = await bcrypt.compare(req.body.password,data.password);
  if(!valid) return res.status(400).send("Wrong password");

  const token = jwt.sign({id:data.id,email:data.email},process.env.JWT_SECRET);
  res.json({token});
});

// AUTH
function auth(req,res,next){
  try{
    req.user = jwt.verify(req.headers.authorization,process.env.JWT_SECRET);
    next();
  }catch{
    res.status(401).send("Unauthorized");
  }
}

// PAYMENT
app.post('/api/pay', auth, async(req,res)=>{
  const bot = req.body.bot;
  const cfg = BOTS[bot];

  const r = await axios.post("https://api.flutterwave.com/v3/payments",{
    tx_ref:Date.now(),
    amount:cfg.price,
    currency:"USD",
    redirect_url:process.env.BASE_URL+"/verify",
    customer:{email:req.user.email},
    meta:{userId:req.user.id,bot}
  },{
    headers:{Authorization:`Bearer ${process.env.FLW_SECRET}`}
  });

  res.json({link:r.data.data.link});
});

// VERIFY
app.get('/verify', async(req,res)=>{
  const tx = req.query.transaction_id;

  const r = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${tx}/verify`,
    {headers:{Authorization:`Bearer ${process.env.FLW_SECRET}`}}
  );

  if(r.data.data.status==="successful"){
    const {userId,bot} = r.data.data.meta;

    await supabase.from('bots').insert([{
      user_id:userId,
      bot,
      start_date:new Date()
    }]);
  }

  res.redirect('/');
});

// DASHBOARD
app.get('/api/dashboard', auth, async(req,res)=>{
  const {data} = await supabase.from('bots')
    .select('*').eq('user_id',req.user.id);

  let totalXP=0;

  const bots = data.map(b=>{
    const days=Math.floor((Date.now()-new Date(b.start_date))/(1000*60*60*24));
    const xp=days*BOTS[b.bot].xp;
    totalXP+=xp;

    return {name:b.bot,days};
  });

  res.json({email:req.user.email,xp:totalXP,bots});
});

app.listen(process.env.PORT||5000);