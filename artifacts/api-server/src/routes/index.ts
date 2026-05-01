import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claudeRouter from "./claude";
import rfqsRouter from "./rfqs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);
router.use(rfqsRouter);

export default router;
