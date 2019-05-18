import {
    _,
    Autowired,
    CellRange,
    ChartType,
    Component,
    Dialog,
    Environment,
    GridOptionsWrapper,
    PostConstruct,
    RefSelector,
    ResizeObserverService,
} from "ag-grid-community";
import {GridChartFactory} from "./gridChartFactory";
import {Chart} from "../../charts/chart/chart";
import {BarSeries} from "../../charts/chart/series/barSeries";
import {LineSeries} from "../../charts/chart/series/lineSeries";
import {PieSeries} from "../../charts/chart/series/pieSeries";
import {palettes} from "../../charts/chart/palettes";
import {CartesianChart} from "../../charts/chart/cartesianChart";
import {PolarChart} from "../../charts/chart/polarChart";
import {ChartMenu} from "./menu/chartMenu";
import {ChartController} from "./chartController";
import {ChartModel} from "./chartModel";
import {Color} from "../../charts/util/color";
import {ChartBuilder} from "../builder/chartBuilder";

export interface GridChartOptions {
    chartType: ChartType;
    insideDialog: boolean;
    showTooltips: boolean;
    aggregate: boolean;
    height: number;
    width: number;
    palette?: number;
}

export class GridChartComp extends Component {
    private static TEMPLATE =
        `<div class="ag-chart" tabindex="-1">
            <div ref="eChart" class="ag-chart-canvas-wrapper"></div>
        </div>`;

    @Autowired('resizeObserverService') private resizeObserverService: ResizeObserverService;
    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('environment') private environment: Environment;

    @RefSelector('eChart') private eChart: HTMLElement;

    private chart: Chart;
    private chartMenu: ChartMenu;
    private chartDialog: Dialog;

    private model: ChartModel;
    private chartController: ChartController;

    private currentChartType: ChartType;

    private readonly gridChartOptions: GridChartOptions;
    private readonly initialCellRange: CellRange;

    constructor(gridChartOptions: GridChartOptions, cellRange: CellRange) {
        super(GridChartComp.TEMPLATE);
        this.gridChartOptions = gridChartOptions;
        this.initialCellRange = cellRange;
    }

    @PostConstruct
    public init(): void {

        if (!this.gridChartOptions.palette) {
            this.gridChartOptions.palette = this.getPalette();
        }

        this.model = new ChartModel(this.gridChartOptions, this.initialCellRange);
        this.getContext().wireBean(this.model);
        this.chartController = new ChartController(this.model);
        this.getContext().wireBean(this.chartController);

        this.createChart();

        if (this.gridChartOptions.insideDialog) {
            this.addDialog();
        }

        this.addMenu();
        this.addResizeListener();

        this.addDestroyableEventListener(this.getGui(), 'focusin', this.setGridChartEditMode.bind(this));
        this.addDestroyableEventListener(this.chartController, ChartController.EVENT_CHART_MODEL_UPDATED, this.refresh.bind(this));
        this.addDestroyableEventListener(this.chartMenu, ChartMenu.EVENT_DOWNLOAD_CHART, this.downloadChart.bind(this));

        this.refresh();
    }

    private createChart() {
        let {width, height} = this.gridChartOptions;

        // destroy chart and remove it from DOM
        if (this.chart) {
            height = this.chart.height;
            width = this.chart.width;
            this.chart.destroy();
            _.clearElement(this.eChart);
        }

        const chartOptions = {
            chartType: this.model.getChartType(),
            processChartOptions: this.gridOptionsWrapper.getProcessChartOptionsFunc(),
            parentElement: this.eChart,
            width: width,
            height: height,
            showTooltips: this.gridChartOptions.showTooltips,
            isDarkTheme: this.isDarkTheme()
        };

        this.chart = GridChartFactory.createChart(chartOptions);
        this.currentChartType = this.model.getChartType();
    }

    private addDialog() {
        this.chartDialog = new Dialog({
            resizable: true,
            movable: true,
            maximizable: true,
            title: '',
            component: this,
            centered: true,
            closable: true
        });
        this.getContext().wireBean(this.chartDialog);

        this.chartDialog.addEventListener(Dialog.EVENT_DESTROYED, () => this.destroy());
    }

    private addMenu() {
        this.chartMenu = new ChartMenu(this.chartController);
        this.chartMenu.setParentComponent(this);
        this.getContext().wireBean(this.chartMenu);

        const eChart: HTMLElement = this.getGui();
        eChart.appendChild(this.chartMenu.getGui());
    }

    private refresh(): void {
        if (this.model.getChartType() !== this.currentChartType) {
            this.createChart();
        }
        this.updateChart();
    }

    public getCurrentChartType(): ChartType {
        return this.currentChartType;
    }

    public updateChart() {
        const chartType = this.model.getChartType();

        const data = this.model.getData();
        const categoryId = this.model.getSelectedDimensionId();
        const fields = this.model.getSelectedColState().map(cs => {
            return {colId: cs.colId, displayName: cs.displayName};
        });

        if (chartType === ChartType.GroupedBar || chartType === ChartType.StackedBar) {
            this.updateBarChart(categoryId, fields, data);

        } else if (chartType === ChartType.Line) {
            this.updateLineChart(categoryId, fields, data);

        } else if (chartType === ChartType.Pie) {
            this.updatePieChart(categoryId, fields, data);

        } else if (chartType === ChartType.Doughnut) {
            this.updateDoughnutChart(categoryId, fields, data);
        }
    }

    private updateBarChart(categoryId: string, fields: { colId: string, displayName: string }[], data: any[]) {
        const barSeries = this.chart.series[0] as BarSeries;

        barSeries.data = data;
        barSeries.xField = categoryId;
        barSeries.yFields = fields.map(f => f.colId);
        barSeries.yFieldNames = fields.map(f => f.displayName);

        //barSeries.colors = palettes[this.getPalette()];
        //barSeries.tooltip = this.chartOptions.showTooltips;
        // barSeries.tooltipRenderer = params => {
        //     const colDisplayName = fields.filter(f => f.colId === params.yField)[0].displayName;
        //     return `<div><b>${colDisplayName}</b>: ${params.datum[params.yField]}</div>`;
        // };
    }

    private updateLineChart(categoryId: string, fields: { colId: string, displayName: string }[], data: any[]) {
        if (fields.length === 0) {
            this.chart.removeAllSeries();
            return;
        }

        const lineChart = this.chart as CartesianChart;
        const fieldIds = fields.map(f => f.colId);

        const existingSeriesMap: { [id: string]: LineSeries } = {};
        lineChart.series.forEach(series => {
            const lineSeries = (series as LineSeries);
            const id = lineSeries.yField as string;
            fieldIds.indexOf(id) > -1 ? existingSeriesMap[id] = lineSeries : lineChart.removeSeries(lineSeries);
        });

        fields.forEach((f: { colId: string, displayName: string }, index: number) => {
            const existingSeries = existingSeriesMap[f.colId];

            let lineSeries: LineSeries;
            if (existingSeries) {
                lineSeries = existingSeries;
            } else {
                const colors = palettes[this.getPalette()];

                const defaultLineSeriesDef = {
                    type: 'line',
                    lineWidth: 3,
                    markerRadius: 3,
                    color: colors[index % colors.length],
                    tooltip: this.gridChartOptions.showTooltips,
                    tooltipRenderer: (params: any) => { //TODO
                        return `<div><b>${f.displayName}</b>: ${params.datum[params.yField]}</div>`;
                    }
                };

                // const mergedLineSeriesDefs = _.assign(defaultLineSeriesDef, this.gridChartOptions.chartOptions.lineSeries);
                // lineSeries = ChartBuilder.createSeries(mergedLineSeriesDefs) as LineSeries; const mergedLineSeriesDefs = _.assign(defaultLineSeriesDef, this.gridChartOptions.chartOptions.lineSeries);
                lineSeries = ChartBuilder.createSeries(defaultLineSeriesDef) as LineSeries;
            }

            if (lineSeries) {
                lineSeries.title = f.displayName;
                lineSeries.data = this.model.getData();
                lineSeries.xField = categoryId;
                lineSeries.yField = f.colId;

                if (!existingSeries) {
                    lineChart.addSeries(lineSeries);
                }
            }
        });
    }

    private updatePieChart(categoryId: string, fields: { colId: string, displayName: string }[], data: any[]) {
        if (fields.length === 0) {
            this.chart.removeAllSeries();
            return;
        }

        const pieChart = this.chart as PolarChart;

        const existingSeries = pieChart.series[0] as PieSeries;
        const existingSeriesId = existingSeries && existingSeries.angleField as string;

        const pieSeriesId = fields[0].colId;
        const pieSeriesName = fields[0].displayName;

        let pieSeries = existingSeries;
        if (existingSeriesId !== pieSeriesId) {


            pieChart.removeSeries(existingSeries);

            const defaultPieSeriesDef = {
                type: 'pie',
                title: pieSeriesName,
                tooltip: this.gridChartOptions.showTooltips,
                tooltipRenderer: (params: any) => {
                    return `<div><b>${params.datum[params.labelField as string]}</b>: ${params.datum[params.angleField]}</div>`;
                },
                showInLegend: true,
                lineWidth: 1,
                calloutWidth: 1,
                label: false,
                labelColor: this.isDarkTheme() ? 'rgb(221, 221, 221)' : 'black',
                colors: palettes[this.getPalette()],
                angleField: pieSeriesId,
                labelField: categoryId
            };

            // const mergedPieSeriesDefs = _.assign(defaultPieSeriesDef, this.gridChartOptions.chartOptions.pieSeries);
            // pieSeries = ChartBuilder.createSeries(mergedPieSeriesDefs) as PieSeries;
            pieSeries = ChartBuilder.createSeries(defaultPieSeriesDef) as PieSeries;
        }

        pieSeries.data = data;

        if (!existingSeries) {
            pieChart.addSeries(pieSeries)
        }
    }

    private updateDoughnutChart(categoryId: string, fields: { colId: string, displayName: string }[], data: any[]) {
        if (fields.length === 0) {
            this.chart.removeAllSeries();
            return;
        }

        const doughnutChart = this.chart as PolarChart;
        const fieldIds = fields.map(f => f.colId);

        const existingSeriesMap: { [id: string]: PieSeries } = {};
        doughnutChart.series.forEach(series => {
            const pieSeries = (series as PieSeries);
            const id = pieSeries.angleField as string;
            fieldIds.indexOf(id) > -1 ? existingSeriesMap[id] = pieSeries : doughnutChart.removeSeries(pieSeries);
        });

        let offset = 0;
        fields.forEach((f: { colId: string, displayName: string }, index: number) => {
            const existingSeries = existingSeriesMap[f.colId];

            const pieSeries = existingSeries ? existingSeries : new PieSeries();

            pieSeries.title = f.displayName;

            pieSeries.tooltip = this.gridChartOptions.showTooltips;
            pieSeries.tooltipRenderer = params => {
                return `<div><b>${params.datum[params.labelField as string]}:</b> ${params.datum[params.angleField]}</div>`;
            };

            pieSeries.showInLegend = index === 0;
            pieSeries.lineWidth = 1;
            pieSeries.calloutWidth = 1;

            pieSeries.outerRadiusOffset = offset;
            offset -= 20;
            pieSeries.innerRadiusOffset = offset;
            offset -= 20;

            pieSeries.data = data;
            pieSeries.angleField = f.colId;

            pieSeries.labelField = categoryId;
            pieSeries.label = false;

            pieSeries.labelColor = this.isDarkTheme() ? 'rgb(221, 221, 221)' : 'black';

            console.log(pieSeries.labelColor);

            pieSeries.colors = palettes[this.getPalette()];

            if (!existingSeries) {
                doughnutChart.addSeries(pieSeries)
            }
        });
    }

    private downloadChart() {
        // TODO use chart / dialog title for filename
        this.chart.scene.download({fileName: "chart"});
    }

    private addResizeListener() {
        const eGui = this.getGui();

        const resizeFunc = () => {
            const eParent = eGui.parentElement as HTMLElement;
            if (!eGui || !eGui.offsetParent) {
                observeResize();
                return;
            }

            this.chart.height = _.getInnerHeight(eParent);
            this.chart.width = _.getInnerWidth(eParent);
        };

        const observeResize = this.resizeObserverService.observeResize(eGui, resizeFunc, 5);
    }

    private setGridChartEditMode(focusEvent: FocusEvent) {
        if (this.getGui().contains(focusEvent.relatedTarget as HTMLElement)) {
            return;
        }
        this.chartController.setChartCellRangesInRangeController();
    }

    private getPalette(): number {
        const palette = this.model && this.model.getPalette();
        return palette ? this.model.getPalette() : this.isDarkTheme() ? 2 : 0;
    }

    private isDarkTheme(): boolean {
        const theme = this.environment.getTheme() as string;
        const el = document.querySelector(`.${theme}`);
        const background = window.getComputedStyle(el as HTMLElement).backgroundColor;
        return Color.fromString(background as string).toHSB()[2] < 0.4;
    }

    public destroy(): void {
        super.destroy();

        if (this.chartController) {
            this.chartController.destroy();
        }
        if (this.chart) {
            this.chart.destroy();
        }
        if (this.chartMenu) {
            this.chartMenu.destroy();
        }

        // don't want to invoke destroy() on the Dialog / MessageBox (prevents destroy loop)
        if (this.chartDialog && this.chartDialog.isAlive()) {
            this.chartDialog.destroy();
        }

        // if the user is providing containers for the charts, we need to clean up, otherwise the old chart
        // data will still be visible although the chart is no longer bound to the grid
        _.clearElement(this.getGui());
    }
}
