import { Router, Request, Response, NextFunction } from "express";
import ApiController from "../controllers/ApiController";
import * as passport from "passport";
import { needAuth } from "../middlewares/checkAuth";

const router = Router();

router.get("/", needAuth, ApiController.getIndex);
router.get("/:id", needAuth, ApiController.getShow);
router.get("/:id/edit", needAuth, ApiController.getEdit);
router.put("/:id", needAuth, ApiController.put);
router.delete("/:id", needAuth, ApiController.delete);

export default router;