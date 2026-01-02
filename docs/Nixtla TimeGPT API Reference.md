# Nixtla TimeGPT API Reference

**Complete API Documentation for LLMs**

Base URL: https://api.nixtla.io

API Version: 2025.8.3

\---

## Table of Contents

1\. Validate API Key  
2\. Foundational Time Series Model Multi Series (Forecast)  
3\. Foundational Time Series Model Multi Series Cross Validation  
4\. Foundational Time Series Model Multi Series Historic  
5\. Foundational Time Series Model Multi Series Anomaly Detector  
6\. Foundational Time Series Model Online Multi Series Anomaly Detector  
7\. Foundational Time Series Model Multi Series Finetuning  
8\. List Fine-tuned Models  
9\. Get Single Fine-tuned Model  
10\. Delete Fine-tuned Model

\---

## Authentication

All endpoints require Bearer token authentication via the Authorization header:

Authorization: Bearer YOUR\_API\_KEY  
Get your API key at: https://dashboard.nixtla.io

\---

## 1\. Validate API Key

**GET** /validate\_api\_key

Validates your API key.

### OpenAPI Specification

openapi: 3.1.0  
info:  
  title: Nixtla Forecast API  
  version: 2025.8.3  
servers:  
  \- url: https://api.nixtla.io  
paths:  
  /validate\_api\_key:  
    get:  
      summary: Validate Api Key  
      operationId: validate\_api\_key\_validate\_api\_key\_get  
      responses:  
        '200':  
          description: Successful Response  
      security:  
        \- HTTPBearer: \[\]  
components:  
  securitySchemes:  
    HTTPBearer:  
      type: http  
      scheme: bearer  
\---

## 2\. Foundational Time Series Model Multi Series (Forecast)

**POST** /v2/forecast

Based on the provided data, this endpoint predicts the future values of multiple time series at once.

### Required Parameters

* **series**: Object containing y (historic values) and sizes (array of series lengths)  
* **freq**: Data frequency (D=daily, M=monthly, H=hourly, W=weekly)  
* **h**: Forecasting horizon (number of future time steps)

### Optional Parameters

* **model**: Model to use (default: timegpt-1, or timegpt-1-long-horizon for long forecasts)  
* **level**: Prediction interval percentages (e.g., \[80, 90\])  
* **finetune\_steps**: Number of fine-tuning steps (0 for zero-shot)  
* **finetune\_loss**: Loss function (default, mae, mse, rmse, mape, smape, poisson)  
* **finetune\_depth**: Fine-tuning depth (1-5)  
* **finetuned\_model\_id**: ID of previously fine-tuned model  
* **feature\_contributions**: Compute exogenous feature contributions

### Response

* **input\_tokens**: Number of input tokens used  
* **output\_tokens**: Number of output tokens used  
* **finetune\_tokens**: Number of fine-tune tokens used  
* **mean**: Predicted values array  
* **intervals**: Prediction intervals (if level specified)

\---

## 3\. Foundational Time Series Model Multi Series Cross Validation

**POST** /v2/cross\_validation

Perform Cross Validation for multiple series.

### Required Parameters

* **series**: Object containing y and sizes  
* **freq**: Data frequency  
* **h**: Forecasting horizon  
* **n\_windows**: Number of cross-validation windows

### Optional Parameters

* **model**, **level**, **finetune\_steps**, **finetune\_loss**, **finetune\_depth**  
* **step\_size**: Step between CV windows (default: h)  
* **hist\_exog**: Indices of historical exogenous features  
* **refit**: Re-finetune in each window (default: true)

### Response

* **mean**: Predicted values  
* **sizes**: Result sizes per series  
* **idxs**: Window indices

\---

## 4\. Foundational Time Series Model Multi Series Historic

**POST** /v2/historic\_forecast

Predicts in-sample (historical) values. Useful for anomaly detection.

### Required Parameters

* **series**: Object containing y and sizes  
* **freq**: Data frequency

### Optional Parameters

* **model**, **level**, **finetuned\_model\_id**, **feature\_contributions**

### Response

* **mean**: In-sample predictions  
* **sizes**: Result sizes per series

\---

## 5\. Foundational Time Series Model Multi Series Anomaly Detector

**POST** /v2/anomaly\_detection

Detects anomalies in historical data.

### Required Parameters

* **series**: Object containing y and sizes  
* **freq**: Data frequency

### Optional Parameters

* **model**, **finetuned\_model\_id**  
* **level**: Confidence level for anomaly detection (0-100, default: 99\)

### Response

* **mean**: Expected values  
* **anomaly**: Boolean array indicating anomalies  
* **intervals**: Prediction intervals used for detection

\---

## 6\. Foundational Time Series Model Online Multi Series Anomaly Detector

**POST** /v2/online\_anomaly\_detection

Online anomaly detection using cross-validation for robust detection.

### Required Parameters

* **series**: Object containing y and sizes  
* **freq**: Data frequency  
* **h**: Forecasting horizon  
* **detection\_size**: Window size for anomaly detection

### Optional Parameters

* **threshold\_method**: univariate or multivariate (default: univariate)  
* **model**, **level**, **finetune\_steps**, **finetune\_loss**, **finetune\_depth**  
* **step\_size**: Step between CV windows

### Response

* **anomaly**: Boolean array indicating anomalies  
* **anomaly\_score**: Z-scores for each point  
* **accumulated\_anomaly\_score**: Cumulative anomaly scores

\---

## 7\. Foundational Time Series Model Multi Series Finetuning

**POST** /v2/finetune

Fine-tune the model and save for later use.

### Required Parameters

* **series**: Object containing y and sizes  
* **freq**: Data frequency

### Optional Parameters

* **model**: Base model (default: timegpt-1)  
* **finetune\_steps**: Number of training steps (default: 10\)  
* **finetune\_loss**: Loss function  
* **finetune\_depth**: Fine-tuning depth (1-5)  
* **output\_model\_id**: Custom ID for the fine-tuned model  
* **finetuned\_model\_id**: ID of model to continue fine-tuning from

### Response

* **finetuned\_model\_id**: ID of the created fine-tuned model

\---

## 8\. List Fine-tuned Models

**GET** /v2/finetuned\_models

Lists all your fine-tuned models.

### Response

Array of fine-tuned models with:

* **id**: Model ID  
* **created\_at**: Creation timestamp  
* **base\_model\_id**: Base model used  
* **steps**, **depth**, **loss**, **model**, **freq**: Training parameters

\---

## 9\. Get Single Fine-tuned Model

**GET** /v2/finetuned\_models/{finetuned\_model\_id}

Retrieves metadata for a specific fine-tuned model.

### Path Parameters

* **finetuned\_model\_id**: ID of the model to retrieve

### Response

Model metadata including id, created\_at, base\_model\_id, steps, depth, loss, model, freq

\---

## 10\. Delete Fine-tuned Model

**DELETE** /v2/finetuned\_models/{finetuned\_model\_id}

Deletes a fine-tuned model.

### Path Parameters

* **finetuned\_model\_id**: ID of the model to delete

### Response

204 No Content on success

\---

## Common Data Structures

### Series Data Format

{  
  "series": {  
    "y": \[1, 2, 3, 4, 5\],  
    "sizes": \[5\],  
    "X": \[\[1.0, 2.0, ...\]\]  
  }  
}  
For multiple series, concatenate y values and provide sizes for each series.

### Frequency Codes

| Code | Description |  
|------|-------------|  
| D | Daily |  
| W | Weekly |  
| M | Monthly |  
| MS | Month Start |  
| H | Hourly |

### Model Options

| Model | Description |  
|-------|-------------|  
| timegpt-1 | Default model for general forecasting |  
| timegpt-1-long-horizon | For forecasting beyond one seasonal period |

### Loss Functions

| Loss | Description |  
|------|-------------|  
| default | Robust loss (less sensitive to outliers) |  
| mae | Mean Absolute Error |  
| mse | Mean Squared Error |  
| rmse | Root Mean Squared Error |  
| mape | Mean Absolute Percentage Error |  
| smape | Symmetric MAPE |  
| poisson | Poisson Loss |

\---

## Error Handling

Validation errors return:  
{  
  "detail": \[  
    {  
      "loc": \["body", "field\_name"\],  
      "msg": "Error message",  
      "type": "error\_type"  
    }  
  \]  
}  
\---

## Resources

* API Key: https://dashboard.nixtla.io  
* Documentation: https://www.nixtla.io/docs  
* Contact: ops@nixtla.io

\---

*Generated from Nixtla API Reference Documentation*  
