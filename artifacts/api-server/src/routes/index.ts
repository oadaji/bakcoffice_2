import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claudeRouter from "./claude";
import rfqsRouter from "./rfqs";
import { gmailRouter } from "./gmail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);
router.use(rfqsRouter);
router.use(gmailRouter);

export default router;
