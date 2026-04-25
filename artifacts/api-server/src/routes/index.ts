import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claudeRouter from "./claude";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);

export default router;
