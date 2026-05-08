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
import { marketIntelRouter } from "./market-intel";
import { settingsRouter } from "./settings";
import { emailAccountsRouter } from "./email-accounts";
import { watiRouter } from "./wati";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claudeRouter);
router.use(rfqsRouter);
router.use(gmailRouter);
router.use(emailAccountsRouter);
router.use(partnersRouter);
router.use(ratesRouter);
router.use(quotesRouter);
router.use(seedRouter);
router.use(outreachRouter);
router.use(marketIntelRouter);
router.use(settingsRouter);
router.use(watiRouter);

export default router;
