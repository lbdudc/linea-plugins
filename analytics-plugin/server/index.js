import { check } from 'express-validator'
import { runFullAnalysis, runBddAnalysis, runMetric, configure } from './flamapy.js'

/**
 * Split a flamapy-server failure into the two cases the editor must treat differently: a genuine parse/validation error (the model IS
 * wrong) vs. the analysis service being unreachable or erroring (we can't judge the model: the editor must NOT then say "model invalid").
 */
const flamapyError = (res, err) => {
  const m = /flamapy-server (\d{3}): ([\s\S]*)/.exec(err?.message ?? '')
  if (m && m[1] === '400') {
    let detail = m[2]
    try { detail = JSON.parse(m[2]).detail ?? detail } catch { /* keep raw */ }
    return res.status(400).json({ error: 'error_messages.uvl_validation_error', detail })
  }
  return res.status(503).json({ error: 'error_messages.analysis_unavailable', code: 'ANALYSIS_UNAVAILABLE' })
}

export default {
  register(ctx) {
    const { requireAuth, asyncHandler, rateLimit, handleValidationErrors } = ctx.services
    configure(() => ctx.settings().url)
    const router = ctx.router()

    // 20 analysis calls per user per 10 minutes
    const limited = [requireAuth, rateLimit(20, 10 * 60 * 1000)]
    const uvl = check('uvl').isString().notEmpty().withMessage('error_messages.content_validation')

    router.post('/analyze', ...limited, uvl, handleValidationErrors, asyncHandler(async (req, res) => {
      let results
      try {
        results = await runFullAnalysis(req.body.uvl, req.body.mode)
      } catch (err) {
        return flamapyError(res, err)
      }
      if (results._skipped?.length > 0) {
        console.info(`[analytics] ${results._modelSize} model (${results._featureCount} features, ${results._solveMode}) — skipped: ${results._skipped.join(', ')}`)
      }
      return res.json(results)
    }))

    router.post('/analyze/bdd', ...limited, uvl, handleValidationErrors, asyncHandler(async (req, res) => {
      try {
        return res.json(await runBddAnalysis(req.body.uvl))
      } catch (err) {
        return flamapyError(res, err)
      }
    }))

    router.post(
      '/analyze/metric',
      ...limited,
      uvl,
      check('metric').isIn(['satisfiable', 'deadFeatures']).withMessage('error_messages.internal_error'),
      check('mode').isIn(['SAT', 'BDD']).withMessage('error_messages.internal_error'),
      handleValidationErrors,
      asyncHandler(async (req, res) => {
        try {
          return res.json({ ...(await runMetric(req.body.uvl, req.body.metric, req.body.mode)) })
        } catch (err) {
          return flamapyError(res, err)
        }
      }),
    )

    // the path this had before it was a plugin's (linea-mcp calls it)
    ctx.alias('/api/lines/analyze', '/analyze')
  },
}
