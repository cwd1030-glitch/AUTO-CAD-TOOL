import os
import sys
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables from .env file
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Add python_backend to path so we can import packages smoothly
sys.path.append(os.path.join(os.path.dirname(__file__), 'python_backend'))

# Import the core compatibility modules
import flow_solver
import cooling_solver
import sinkmark_solver
import metrics_aggregator

app = Flask(__name__)
CORS(app)  # Enable CORS to allow cross-origin requests from frontend browser

@app.route('/api/simulate', methods=['POST'])
@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"status": "error", "message": "Missing or invalid JSON request body"}), 400

        print("수신된 사출 조건:", data)
        cooling_enabled = data.get('cooling_enabled', data.get('coolingEnabled', False))
        validated_metrics = None  # 검증된 솔버 기반 요약 지표(수축/휨). 정밀 모드에서만 채워짐.

        if cooling_enabled:
            # 🟢 냉각 탭 ON: 논문 공식이 적용된 정밀 열전달 연계 해석 실행
            print("냉각 연계 모드 활성화: 초정밀 유동 및 싱크마크 연산 시작")
            
            # 1. 냉각 온도장 및 고화 수축률 계산 (논문 공식 적용)
            cooling_grid = cooling_solver.calculate_transient_thermal_field(data)
            
            # 2. 냉각 속도에 따른 점도 변화를 반영하여 유동 및 웰드라인 위치 실시간 계산
            weld_lines, vertex_fill_times = flow_solver.calculate_weld_lines_with_cooling(cooling_grid, data)
            
            # 3. Hot Spot(열집중) 정보를 결합하여 싱크마크 정확도 고도화
            sink_marks = sinkmark_solver.calculate_sinkmarks_with_thermal(cooling_grid, data)

            # 4. 검증된 솔버 출력에서 수축%/휨 요약 지표 산출(프런트 JS 추정식을 대체할 권위값)
            try:
                validated_metrics = metrics_aggregator.aggregate_defect_metrics(
                    cooling_grid["voxel_grid"],
                    cooling_grid["T_final"],
                    cooling_grid["solidification_time"],
                )
            except Exception as _mErr:
                print("지표 집계 실패(무시하고 진행):", _mErr)
                validated_metrics = None

            vertex_temperatures = cooling_grid["vertex_temperatures"]
            cooling_channels = cooling_grid["channels"]
            cycle_time = float(cooling_grid.get("cycle_time", 0.0))
        else:
            # 🔴 냉각 탭 OFF: 기하학적 형상 기반 고속 예측 모드 실행
            print("냉각 연계 모드 비활성화: 고속 단순 형상 분석 진행")
            weld_lines, vertex_fill_times = flow_solver.calculate_weld_lines_geometric_only(data)
            sink_marks = sinkmark_solver.calculate_sinkmarks_geometric_only(data)
            vertex_temperatures = []  # 냉각 표시는 빈 값 처리
            cooling_channels = []
            cycle_time = 0.0
            
        return jsonify({
            "status": "success",
            "weldLines": weld_lines,
            "weld_lines": weld_lines,
            "sinkMarks": sink_marks,
            "vertex_sink_risk": sink_marks,
            "vertexTemperatures": vertex_temperatures,
            "vertex_temperatures": vertex_temperatures,
            "coolingChannels": cooling_channels,
            "cooling_channels": cooling_channels,
            "cycle_time": cycle_time,
            "vertex_fill_times": vertex_fill_times,
            "vertexFillTimes": vertex_fill_times,
            "validated_metrics": validated_metrics
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/ai-review', methods=['POST'])
def ai_review():
    try:
        if not GEMINI_API_KEY or GEMINI_API_KEY == "여기에_구글_AI_스튜디오에서_발급받은_키를_입력하세요":
            return jsonify({"status": "error", "message": "Gemini API 키가 설정되지 않았습니다. .env 파일을 확인해주세요."}), 400

        data = request.get_json(silent=True)
        if not data:
            return jsonify({"status": "error", "message": "Missing or invalid JSON request body"}), 400

        # 시스템 프롬프트 정의
        system_prompt = """You are DIMA AI Reviewer.
You are an expert in:
- Injection Molding
- Mold Design
- Plastic Product Design
- DFM
- Manufacturing Engineering
- Tooling Engineering

Your job is NOT to analyze CAD data. DIMA already completed all geometry calculations.
Your job is to review DIMA analysis results and provide practical engineering recommendations.

==================================================
OUTPUT FORMAT
Return JSON only. Do NOT wrap in markdown code blocks like ```json ... ```. Just return raw JSON.
{
  "rating": "GOOD|WARNING|RISK",
  "grade": "A|B|C|D",
  "summary": "1-2 sentence overall summary",
  "recommendations": [
    {
      "category": "Thickness|Draft|Gate|Cooling|Sink|Shrinkage",
      "issue": "Description of the problem",
      "solution": "Actionable engineering advice"
    }
  ]
}
"""
        
        # 모델 초기화 (JSON 모드 설정)
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=system_prompt,
            generation_config={"response_mime_type": "application/json"}
        )

        user_prompt = f"Here is the DIMA analysis JSON:\n\n{json.dumps(data, indent=2)}\n\nPlease provide your expert review in JSON format."
        
        print("요청 중: Gemini API AI Review...")
        response = model.generate_content(user_prompt)
        
        # 응답 파싱
        try:
            ai_result = json.loads(response.text)
        except json.JSONDecodeError:
            print("Failed to parse Gemini response as JSON:", response.text)
            return jsonify({"status": "error", "message": "AI 응답을 JSON으로 파싱할 수 없습니다.", "raw_response": response.text}), 500

        print("AI Review 생성 완료")
        return jsonify({
            "status": "success",
            "ai_review": ai_result
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

def call_openai_http(api_key, model, system_prompt, user_prompt):
    import urllib.request
    import json
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.4
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        return res_data["choices"][0]["message"]["content"]

def call_claude_http(api_key, model, system_prompt, user_prompt):
    import urllib.request
    import json
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    }
    data = {
        "model": model,
        "max_tokens": 4000,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.4
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        return res_data["content"][0]["text"]

def call_gemini_http(api_key, model, system_prompt, user_prompt):
    import urllib.request
    import json
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    headers = {
        "Content-Type": "application/json"
    }
    data = {
        "contents": [
            {
                "parts": [
                    {"text": f"{system_prompt}\n\nUser Input:\n{user_prompt}"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json"
        }
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req) as response:
        res_data = json.loads(response.read().decode('utf-8'))
        return res_data["candidates"][0]["content"]["parts"][0]["text"]

@app.route('/api/multi-ai-review', methods=['POST'])
def multi_ai_review():
    try:
        body = request.get_json(silent=True) or {}
        dima_data = body.get("dima_data")
        openai_key = body.get("openai_key")
        gemini_key = body.get("gemini_key")
        claude_key = body.get("claude_key")
        
        if not dima_data:
            return jsonify({"status": "error", "message": "DIMA 결과 데이터가 누락되었습니다."}), 400
        if not openai_key or not gemini_key or not claude_key:
            return jsonify({"status": "error", "message": "API 키가 누락되었습니다. ChatGPT, Gemini, Claude API 키가 모두 입력되었는지 확인해주세요."}), 400

        # 1. Claude 의견 구하기
        claude_system = """You are an expert Mold and Tooling Design Engineer. Analyze the given DIMA injection molding simulation results.
Focus on mold parting lines, slides, lifters, undercut difficulty, venting, and mold structure feasibility.
Provide your technical analysis and engineering recommendations in a concise paragraph in Korean."""
        
        claude_user = f"DIMA JSON:\n{json.dumps(dima_data, indent=2)}"
        
        try:
            print("Calling Claude API...")
            claude_opinion = call_claude_http(claude_key, "claude-3-5-sonnet-20241022", claude_system, claude_user)
        except Exception as e:
            print(f"Claude API failed: {e}")
            return jsonify({"status": "error", "message": f"Claude API 호출 실패: {str(e)}"}), 500

        # 2. ChatGPT 의견 구하기
        openai_system = """You are an expert Injection Molding Process Engineer. Analyze the given DIMA simulation results.
Focus on material properties, melt/mold temperatures, filling behavior, sink marks, shrinkage, warpage, and gate locations.
Provide your technical analysis and process parameter recommendations in a concise paragraph in Korean."""
        
        openai_user = f"DIMA JSON:\n{json.dumps(dima_data, indent=2)}"
        
        try:
            print("Calling OpenAI API...")
            openai_opinion = call_openai_http(openai_key, "gpt-4o-mini", openai_system, openai_user)
        except Exception as e:
            print(f"OpenAI API failed: {e}")
            return jsonify({"status": "error", "message": f"ChatGPT API 호출 실패: {str(e)}"}), 500

        # 3. Gemini 최종 종합 및 팀장 리뷰 작성
        gemini_system = """You are the senior Team Leader of a Mold Design and Injection Molding department.
You have received two technical reports from your team:
1. Mold Design analysis from Claude (Mold Designer).
2. Process and Material analysis from ChatGPT (Process Engineer).

Your job is to read both reports, moderate the discussion, synthesize their viewpoints, resolve any contradictions, and output a final comprehensive DIMA AI review report.

Respond in Korean.
Output STRICT JSON ONLY. Do NOT wrap in markdown code blocks.
JSON format:
{
  "overallRating": "GOOD|WARNING|CRITICAL",
  "summary": "종합 평가 요약 (팀장 코멘트)",
  "moldDifficulty": "LOW|MEDIUM|HIGH",
  "costImpact": "LOW|MEDIUM|HIGH",
  "recommendedGate": "추천 게이트 정보",
  "claudeOpinion": "Claude 의견 요약",
  "chatgptOpinion": "ChatGPT 의견 요약",
  "topIssues": [
    {
      "issue": "문제점 제목",
      "cause": "원인 설명",
      "recommendation": "해결책/개선안 (금형 또는 공정적 방법)"
    }
  ]
}"""

        gemini_user = f"""DIMA JSON:
{json.dumps(dima_data, indent=2)}

[금형설계 전문가 Claude 보고서]:
{claude_opinion}

[사출공정 전문가 ChatGPT 보고서]:
{openai_opinion}"""

        try:
            print("Calling Gemini API...")
            gemini_synthesis = call_gemini_http(gemini_key, "gemini-2.5-flash", gemini_system, gemini_user)
            gemini_synthesis = gemini_synthesis.strip()
            if gemini_synthesis.startswith("```json"):
                gemini_synthesis = gemini_synthesis[7:]
            if gemini_synthesis.endswith("```"):
                gemini_synthesis = gemini_synthesis[:-3]
            gemini_synthesis = gemini_synthesis.strip()
            
            review_json = json.loads(gemini_synthesis)
            
            if "claudeOpinion" not in review_json or not review_json["claudeOpinion"]:
                review_json["claudeOpinion"] = claude_opinion
            if "chatgptOpinion" not in review_json or not review_json["chatgptOpinion"]:
                review_json["chatgptOpinion"] = openai_opinion
                
            return jsonify({
                "status": "success",
                "ai_review": review_json
            })
        except Exception as e:
            print(f"Gemini API failed or JSON parse error: {e}")
            return jsonify({"status": "error", "message": f"Gemini 최종 종합 연산 실패: {str(e)}"}), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    # Runs the Flask server on http://127.0.0.1:5000/ by default.
    # Port is configurable via DIMA_FLASK_PORT; debug defaults to OFF because
    # Flask's debug mode exposes the Werkzeug interactive debugger (arbitrary
    # code execution) and starts a double process via the reloader — both
    # undesirable for a packaged offline desktop app. Set DIMA_DEBUG=1 only
    # for local development.
    port = int(os.getenv("DIMA_FLASK_PORT", "5000"))
    debug = os.getenv("DIMA_DEBUG", "0") == "1"
    app.run(host='127.0.0.1', port=port, debug=debug)
