import express from 'express';
const app=express();app.get('/',(_req,res)=>res.json({message:'Your workspace arrived.',workspace:process.cwd()}));app.listen(Number(process.env.PORT||3000),'127.0.0.1');
