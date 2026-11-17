import { Container } from 'typedi';
import { linea } from '../../linea/LineaClient.js';

/** Fleet figures LINEA keeps from the generations it runs. */
export default class LogService {
  getDeploymentMetrics = async () => linea.get('/api/logs/metrics');
}

Container.set(LogService, new LogService());
