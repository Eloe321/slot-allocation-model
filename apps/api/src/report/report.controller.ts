import { Controller, Get, Header, Param, ParseIntPipe } from '@nestjs/common';
import { DemoRoles } from '../demo/demo-access.js';
import { ReportService } from './report.service.js';

@Controller('configs/:id/report')
@DemoRoles('administrator', 'operator')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get()
  get(@Param('id', ParseIntPipe) id: number) {
    return this.reports.forConfig(id);
  }

  @Get('csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inventory-report.csv"')
  async csv(@Param('id', ParseIntPipe) id: number) {
    return this.reports.toCsv(await this.reports.forConfig(id));
  }
}
