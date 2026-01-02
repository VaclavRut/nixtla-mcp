export interface NixtlaSeries {
  y: number[];
  sizes: number[];
  X?: number[][];
}

export interface NixtlaForecastRequest {
  series: NixtlaSeries;
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  h: number;
  model?: string;
  level?: number[];
  finetune_steps?: number;
  finetune_loss?: string;
  finetune_depth?: number;
  finetuned_model_id?: string;
  feature_contributions?: boolean;
}

export interface NixtlaForecastResponse {
  input_tokens: number;
  output_tokens: number;
  finetune_tokens: number;
  mean: number[];
  intervals?: Record<string, { lower: number[]; upper: number[] }>;
  feature_contributions?: Record<string, number[]>;
}

export interface NixtlaFinetuneRequest {
  series: NixtlaSeries;
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  model?: string;
  finetune_steps?: number;
  finetune_loss?: string;
  finetune_depth?: number;
  output_model_id?: string;
  finetuned_model_id?: string;
}

export interface NixtlaFinetuneResponse {
  finetuned_model_id: string;
}

export interface NixtlaFinetunedModel {
  id: string;
  created_at: string;
  base_model_id?: string; // Optional - may not be present in all API responses
  steps: number;
  depth: number;
  loss: string;
  model: string;
  freq: string;
}

export interface NixtlaAnomalyRequest {
  series: NixtlaSeries;
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  model?: string;
  finetuned_model_id?: string;
  level?: number;
}

export interface NixtlaAnomalyResponse {
  mean: number[];
  anomaly: boolean[];
  intervals?: Record<string, { lower: number[]; upper: number[] }>;
}

export interface NixtlaOnlineAnomalyRequest {
  series: NixtlaSeries;
  freq: 'D' | 'H' | 'W' | 'M' | 'MS';
  h: number;
  detection_size: number;
  threshold_method?: 'univariate' | 'multivariate';
  model?: string;
  level?: number;
  finetune_steps?: number;
  finetune_loss?: string;
  finetune_depth?: number;
  step_size?: number;
}

export interface NixtlaOnlineAnomalyResponse {
  anomaly: boolean[];
  anomaly_score: number[];
  accumulated_anomaly_score: number[];
}
