export default async function handler(req, res) {
  // Разрешаем только POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    // ==========================================
    // 1. Получаем изображение от ChatGPT
    // ==========================================

    let imageUrl = null;

    if (
      Array.isArray(body.openaiFileIdRefs) &&
      body.openaiFileIdRefs.length > 0
    ) {
      const file = body.openaiFileIdRefs[0];

      imageUrl =
        file.download_link ||
        file.downloadLink ||
        file.url ||
        null;
    }

    // Для ручного тестирования через image_url
    if (!imageUrl && typeof body.image_url === "string") {
      imageUrl = body.image_url;
    }

    if (!imageUrl) {
      return res.status(400).json({
        error: "Не найдено изображение",
        details:
          "ChatGPT должен передать openaiFileIdRefs с download_link."
      });
    }

    // ==========================================
    // 2. Получаем API KEY
    // ==========================================

    const apiKey = process.env.GENAPI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Не настроен GENAPI_API_KEY в Vercel."
      });
    }

    // ==========================================
    // 3. Запускаем векторизацию
    // ==========================================

    const createResponse = await fetch(
      "https://api.gen-api.ru/api/v1/networks/image-2-svg",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },

        body: JSON.stringify({
          is_sync: false,

          image_url: imageUrl,

          colormode: "color",
          hierarchical: "stacked",
          mode: "spline",

          filter_speckle: 4,
          color_precision: 6,
          layer_difference: 16,
          corner_threshold: 60,
          length_threshold: 4,
          max_iterations: 10,
          splice_threshold: 45,
          path_precision: 3
        })
      }
    );

    const createData = await createResponse.json();

    if (!createResponse.ok) {
      return res.status(createResponse.status).json({
        error: "Ошибка GenAPI при запуске векторизации",
        details: createData
      });
    }

    const requestId = createData.request_id;

    if (!requestId) {
      return res.status(500).json({
        error: "GenAPI не вернул request_id",
        details: createData
      });
    }

    // ==========================================
    // 4. Ждём готовности результата
    // ==========================================

    const maxAttempts = 15;
    const delay = 3000;

    let resultData = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delay));

      const resultResponse = await fetch(
        `https://api.gen-api.ru/api/v1/request/get/${requestId}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        }
      );

      resultData = await resultResponse.json();

      if (!resultResponse.ok) {
        return res.status(resultResponse.status).json({
          error: "Ошибка при получении результата GenAPI",
          details: resultData
        });
      }

      // ========================================
      // ГОТОВО
      // ========================================

      if (resultData.status === "success") {
        const result = resultData.result;

        if (Array.isArray(result) && result.length > 0) {
          return res.status(200).json({
            success: true,
            message: "Изображение успешно векторизовано.",
            request_id: requestId,
            status: "success",
            svg_url: result[0],
            result: result
          });
        }

        return res.status(200).json({
          success: true,
          request_id: requestId,
          status: "success",
          data: resultData
        });
      }

      // ========================================
      // ОШИБКА
      // ========================================

      if (
        resultData.status === "failed" ||
        resultData.status === "error"
      ) {
        return res.status(500).json({
          error: "Векторизация завершилась ошибкой.",
          request_id: requestId,
          status: resultData.status,
          details: resultData
        });
      }
    }

    // ==========================================
    // 5. Если за время ожидания не успело
    // ==========================================

    return res.status(202).json({
      success: false,
      processing: true,
      message:
        "Векторизация ещё выполняется. Попробуйте запросить результат позже.",
      request_id: requestId,
      status: resultData?.status || "processing"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Ошибка сервера",
      details: error.message
    });
  }
}
