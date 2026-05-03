import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claudeRouter from "./claude";
import rfqsRouter from "./rfqs";
import { gmailRouter } from "./gmail";
import { partnersRouter } from "./partners";
import { ratesRouter } from "./rates";
import { quotesRouter } from "./quotes";
import seedRouter from "./seed";
import { outreachRouter } from "./outreach";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);
router.use(rfqsRouter);
router.use(gmailRouter);
router.use(partnersRouter);
router.use(ratesRouter);
router.use(quotesRouter);
router.use(seedRouter);
router.use(outreachRouter);

export default router;
