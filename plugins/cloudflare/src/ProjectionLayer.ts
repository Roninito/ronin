/**
 * ProjectionLayer
 * Sanitizes data before sending to remote clients
 * Ensures internal fields never leak
 */

import type { RouteConfig, ProjectionConfig } from './types.js';

export class ProjectionLayer {
  /**
   * Project a single entity through the filter
   */
  async project(
    entity: any,
    projectionName: string,
    routeConfig: RouteConfig
  ): Promise<any> {
    const projection = routeConfig.projections?.[projectionName];

    if (!projection) {
      // No projection defined - deny by default
      throw new Error(
        `No projection defined for '${projectionName}'. ` +
        `Add to cloudflare.routes.json projections to expose this data.`
      );
    }

    // Apply field whitelist
    return this.applyProjection(entity, projection);
  }

  /**
   * Project an array of entities
   */
  async projectArray(
    entities: any[],
    projectionName: string,
    routeConfig: RouteConfig
  ): Promise<any[]> {
    return Promise.all(
      entities.map(e => this.project(e, projectionName, routeConfig))
    );
  }

  /**
   * Apply projection to entity
   */
  private applyProjection(entity: any, projection: ProjectionConfig): any {
    if (!entity || typeof entity !== 'object') {
      return entity;
    }

    const projected: any = {};

    for (const field of projection.fields) {
      if (field in entity) {
        projected[field] = entity[field];
      }
    }

    return projected;
  }

  /**
   * Auto-project based on entity type detection
   */
  async autoProject(
    data: any,
    routeConfig: RouteConfig
  ): Promise<any> {
    // Detect entity type from data structure
    const projectionName = this.detectEntityType(data);
    
    if (projectionName && routeConfig.projections?.[projectionName]) {
      if (Array.isArray(data)) {
        return this.projectArray(data, projectionName, routeConfig);
      } else {
        return this.project(data, projectionName, routeConfig);
      }
    }

    // No projection available - return minimal safe data
    return this.getMinimalSafeData(data);
  }

  /**
   * Try to detect entity type from data structure
   */
  private detectEntityType(data: any): string | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return null;

    const keys = Object.keys(item);

    // Task detection
    if (keys.includes('title') && keys.includes('status') && keys.includes('priority')) {
      return 'task';
    }

    // Agent detection
    if (keys.includes('name') && keys.includes('schedule') && keys.includes('execute')) {
      return 'agent';
    }

    // File detection
    if (keys.includes('filename') && keys.includes('path') && keys.includes('size')) {
      return 'file';
    }

    // Memory detection
    if (keys.includes('key') && keys.includes('value') && keys.includes('timestamp')) {
      return 'memory';
    }

    return null;
  }

  /**
   * Get minimal safe data when no projection available
   */
  private getMinimalSafeData(data: any): any {
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeObject(item));
    }
    
    return this.sanitizeObject(data);
  }

  /**
   * Sanitize a single object to remove dangerous fields
   */
  private sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const dangerousFields = [
      'password',
      'token',
      'secret',
      'apiKey',
      'privateKey',
      'credentials',
      'auth',
      'internalPath',
      'filePath',
      'absolutePath',
      'diskPath'
    ];

    const safe: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Skip dangerous fields
      if (dangerousFields.some(df => key.toLowerCase().includes(df.toLowerCase()))) {
        continue;
      }

      // Skip functions
      if (typeof value === 'function') {
        continue;
      }

      // Recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        safe[key] = this.sanitizeObject(value);
      } else {
        safe[key] = value;
      }
    }

    return safe;
  }

  /**
   * Validate projection definition
   */
  validateProjection(name: string, projection: ProjectionConfig): boolean {
    if (!projection.fields || !Array.isArray(projection.fields)) {
      console.error(`[ProjectionLayer] Invalid projection '${name}': fields must be an array`);
      return false;
    }

    if (projection.fields.length === 0) {
      console.error(`[ProjectionLayer] Invalid projection '${name}': fields cannot be empty`);
      return false;
    }

    return true;
  }
}
