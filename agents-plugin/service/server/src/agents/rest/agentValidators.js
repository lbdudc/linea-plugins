import { check } from 'express-validator';
import handleValidationErrors from '../../rest/validators/commonValidationHandler.js';

export const createRunValidator = [
    check('agentType').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const decideValidator = [
    check('decision').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const refineValidator = [
    check('message').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const putPolicyValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const putConfigValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('agentType').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('memoryRead').optional().isIn(['none', 'product', 'product_line']).withMessage('error_messages.internal_error'),
    check('memoryWrite').optional().isIn(['off', 'auto', 'run', 'product', 'line']).withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const knowledgeMessageValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('content').isString().notEmpty().withMessage('error_messages.content_validation'),
    handleValidationErrors
];

export const putDispositionValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('signature').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('state').isIn(['dismissed', 'manually-harvested', 'snoozed']).withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const mergeProposalsValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('runIds').isArray({ min: 2 }).withMessage('error_messages.internal_error'),
    check('runIds.*').isMongoId().withMessage('error_messages.internal_error'),
    check('directive').optional().isString().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const splitProposalValidator = [
    check('runId').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const editProposalFileValidator = [
    check('path').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('newContent').isString().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const addMemoryValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('kind').isString().notEmpty().withMessage('error_messages.internal_error'),
    check('content').isString().notEmpty().withMessage('error_messages.internal_error'),
    handleValidationErrors
];
